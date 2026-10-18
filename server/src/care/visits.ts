// Expected visits (home aide, nurse, meals). Each active schedule produces one Visit per matching day.
// Status machine: upcoming -> due (window opens) -> in_progress (arrival seen) -> completed (departure seen)
//                                              \-> late (window closed, nobody yet) -> missed (grace over)
import type { Schedule, Visit, VisitEvidence } from '../../../shared/types.ts'
import { publish } from '../bus.ts'
import { getSetting } from '../db.ts'
import { household, schedules, visits } from '../store.ts'
import { atLocal, clock, localDate, weekdayOfDate } from '../time.ts'
import { createMoment } from './moments.ts'

const ARRIVE_EARLY_MS = 30 * 60_000 // someone can turn up to 30 min before the window

export function ensureVisits(date: string): Visit[] {
  for (const s of schedules.all()) {
    if (!s.active || !s.days.includes(weekdayOfDate(date))) continue
    const id = `v_${s.id}_${date}`
    const existing = visits.get(id)
    // Never judge a window that closed before Homebeat started watching.
    const installed = getSetting<number>('installed_at', 0)
    if (!existing && installed && atLocal(date, s.windowEnd) + s.graceMin * 60_000 < installed) continue
    if (existing) {
      // Keep the window in sync if the schedule changed and the visit hasn't started.
      if (existing.status === 'upcoming') visits.put({ ...existing, label: s.label, who: s.who, expectedStart: atLocal(date, s.windowStart), expectedEnd: atLocal(date, s.windowEnd) })
      continue
    }
    visits.put({
      id,
      scheduleId: s.id,
      label: s.label,
      who: s.who,
      date,
      expectedStart: atLocal(date, s.windowStart),
      expectedEnd: atLocal(date, s.windowEnd),
      status: 'upcoming',
      evidence: [],
    })
  }
  return visits.all(`WHERE date = ? ORDER BY json_extract(json, '$.expectedStart')`, date)
}

const firstName = (who: string) => who.split(/[ (]/)[0]

function save(v: Visit) {
  visits.put(v)
  publish({ type: 'visit', visit: v })
  return v
}

export function tickVisits(now = Date.now()) {
  const today = localDate(now)
  for (const v of ensureVisits(today)) {
    const s = schedules.get(v.scheduleId)
    if (!s || v.sample) continue
    const graceEnd = v.expectedEnd + s.graceMin * 60_000
    if (v.status === 'upcoming' && now >= v.expectedStart) save({ ...v, status: 'due' })
    else if (v.status === 'due' && now > v.expectedEnd) {
      save({ ...v, status: 'late' })
      createMoment({
        kind: 'visit_late',
        severity: 'heads_up',
        at: now,
        title: `${firstName(v.who)} isn't here yet`,
        body: `${v.label} was expected by ${clock(v.expectedEnd)}. Homebeat will tell you the moment ${firstName(v.who)} arrives.`,
        visitId: v.id,
        actions: ['watch_live', 'view_visit'],
      })
    } else if (v.status === 'late' && now > graceEnd) {
      save({ ...v, status: 'missed' })
      createMoment({
        kind: 'visit_missed',
        severity: 'urgent',
        at: now,
        title: `${v.label} missed today`,
        body: `No one matching ${firstName(v.who)}'s visit came to the door between ${clock(v.expectedStart)} and ${clock(graceEnd)}. You may want to call the agency and check on ${currentParent()}.`,
        visitId: v.id,
        actions: ['call_parent', 'view_visit'],
      })
    }
  }
}

const currentParent = () => household.get().parentName

export interface OpenVisit {
  visit: Visit
  schedule: Schedule
}

export function openVisits(now = Date.now()): OpenVisit[] {
  return ensureVisits(localDate(now))
    .filter((v) => ['upcoming', 'due', 'late'].includes(v.status))
    .map((visit) => ({ visit, schedule: schedules.get(visit.scheduleId)! }))
    .filter(({ visit, schedule }) => schedule && now >= visit.expectedStart - ARRIVE_EARLY_MS && now <= visit.expectedEnd + schedule.graceMin * 60_000)
}

export function inProgressVisits(now = Date.now()): OpenVisit[] {
  return ensureVisits(localDate(now))
    .filter((v) => v.status === 'in_progress')
    .map((visit) => ({ visit, schedule: schedules.get(visit.scheduleId)! }))
    .filter((v) => v.schedule)
}

export function markArrived(v: Visit, at: number, evidence: VisitEvidence, snapshotUrl?: string, analysisId?: string, eventIds: string[] = []) {
  const lateByMin = Math.max(0, Math.round((at - v.expectedEnd) / 60_000))
  const updated = save({ ...v, status: 'in_progress', arrivedAt: at, lateByMin, evidence: [...v.evidence, evidence] })
  createMoment({
    kind: 'visit_arrived',
    severity: 'calm',
    at,
    title: `${firstName(v.who)} arrived`,
    body: `${v.label} started at ${clock(at)}${lateByMin ? `, ${lateByMin} min late` : ', on time'}. ${evidence.detail}.`,
    visitId: v.id,
    snapshotUrl,
    analysisId,
    eventIds,
    actions: ['view_visit'],
  })
  return updated
}

export function addEvidence(v: Visit, evidence: VisitEvidence) {
  return save({ ...v, evidence: [...v.evidence, evidence] })
}

export function markDeparted(v: Visit, at: number, evidence: VisitEvidence, snapshotUrl?: string, analysisId?: string, eventIds: string[] = []) {
  const minutes = Math.max(1, Math.round((at - (v.arrivedAt ?? at)) / 60_000))
  const s = schedules.get(v.scheduleId)
  const short = s && minutes < s.expectedMinutes * 0.5
  const updated = save({ ...v, status: 'completed', departedAt: at, minutes, evidence: [...v.evidence, evidence] })
  createMoment({
    kind: 'visit_departed',
    severity: short ? 'heads_up' : 'calm',
    at,
    title: `${firstName(v.who)}'s visit ended`,
    body: short
      ? `${firstName(v.who)} left at ${clock(at)} after ${minutes} min. Visits usually last about ${s!.expectedMinutes} min.`
      : `${firstName(v.who)} was with ${currentParent()} for ${minutes} min (${clock(v.arrivedAt ?? at)}–${clock(at)}).`,
    visitId: v.id,
    snapshotUrl,
    analysisId,
    eventIds,
    actions: ['view_visit'],
  })
  return updated
}

export function checkIn(code: string, now = Date.now()): { ok: boolean; who?: string } {
  const s = schedules.all().find((x) => x.checkinCode && x.checkinCode.toLowerCase() === code.toLowerCase())
  if (!s) return { ok: false }
  const v = ensureVisits(localDate(now)).find((x) => x.scheduleId === s.id)
  if (!v) return { ok: true, who: s.who }
  const evidence: VisitEvidence = { kind: 'checkin_link', at: now, detail: `${firstName(s.who)} tapped the check-in link` }
  if (v.status === 'in_progress' || v.status === 'completed') {
    const ringSeen = v.arrivedAt && Math.abs(now - v.arrivedAt) < 20 * 60_000
    addEvidence(v, { ...evidence, detail: ringSeen ? `${evidence.detail}, matching the doorbell arrival (2 signals)` : evidence.detail })
  } else markArrived(v, now, evidence)
  return { ok: true, who: s.who }
}
