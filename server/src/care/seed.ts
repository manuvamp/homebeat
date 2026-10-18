// First-run setup: Asha's household, two expected visits, three starter rules, and (optionally) a
// sample week of history so the reports aren't empty. Everything seeded here carries sample: true and
// is labelled "Sample" in the UI; live Ring events never are.
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Analysis, Moment, Rule, Schedule, StageResult, Visit } from '../../../shared/types.ts'
import { config, ROOT } from '../config.ts'
import { db, getSetting, setSetting } from '../db.ts'
import { analyses, events, household, moments, rules, schedules, visits } from '../store.ts'
import { addDays, atLocal, clock, localDate, weekdayOfDate } from '../time.ts'

export const DEFAULT_SCHEDULES: Schedule[] = [
  {
    id: 's_aide',
    label: 'Home aide',
    who: 'Maria (BrightCare)',
    visitorType: 'care_worker',
    days: [1, 2, 3, 4, 5],
    windowStart: '09:00',
    windowEnd: '09:15',
    graceMin: 30,
    expectedMinutes: 55,
    vehicleHint: 'silver hatchback',
    checkinCode: 'maria',
    active: true,
  },
  {
    id: 's_meals',
    label: 'Meals on Wheels',
    who: 'Meals on Wheels volunteer',
    visitorType: 'delivery',
    days: [1, 3, 5],
    windowStart: '12:00',
    windowEnd: '12:30',
    graceMin: 45,
    expectedMinutes: 5,
    active: true,
  },
]

const now = () => Date.now()

const DEFAULT_RULES: Omit<Rule, 'createdAt'>[] = [
  {
    id: 'ru_package',
    english: 'If a package sits outside for more than 30 minutes, remind Mom with the chime and tell me.',
    enabled: true,
    fireCount: 0,
    compiled: {
      template: 'package_waiting',
      summary: "If a package sits outside Asha's door for more than 30 min, play a soft chime inside and tell Priya.",
      params: { minutes: 30 },
      actions: [{ type: 'notify', who: 'primary' }, { type: 'chime', slot: 'ring-appstore-event-1' }],
      severity: 'heads_up',
    },
  },
  {
    id: 'ru_night',
    english: 'Anyone at the door between 9:30 at night and 6 in the morning is urgent.',
    enabled: true,
    fireCount: 0,
    compiled: {
      template: 'quiet_hours',
      summary: "Any activity at Asha's door between 21:30 and 06:00 is urgent: tell Priya right away with live view, then Rohan after 5 min.",
      params: { start: '21:30', end: '06:00' },
      actions: [{ type: 'notify', who: 'primary' }, { type: 'live_view' }, { type: 'escalate', afterMin: 5 }],
      severity: 'urgent',
    },
  },
  {
    id: 'ru_quiet',
    english: "Let me know if nobody comes or goes for 6 hours during the day.",
    enabled: true,
    fireCount: 0,
    compiled: {
      template: 'no_activity',
      summary: "If no one comes or goes at Asha's for 6 hours between 8 AM and 8 PM, suggest a check-in call.",
      params: { hours: 6, from: '08:00', to: '20:00' },
      actions: [{ type: 'notify', who: 'primary' }],
      severity: 'note',
    },
  },
]

export function installedAt(): number {
  return getSetting<number>('installed_at', 0)
}

export function seedIfEmpty() {
  if (!getSetting<number>('installed_at', 0)) setSetting('installed_at', now())
  if (!schedules.count()) for (const s of DEFAULT_SCHEDULES) schedules.put(s)
  if (!rules.count()) for (const r of DEFAULT_RULES) rules.put({ ...r, createdAt: now() })
  if (config.household.seedSample && !getSetting('sample_seeded', false)) {
    seedSampleWeek()
    setSetting('sample_seeded', true)
  }
}

// Copy simulator stills into the media folder so sample moments have pictures.
function sampleImage(name: string): string | undefined {
  const src = join(ROOT, 'server', 'assets', 'sim', `${name}.jpg`)
  if (!existsSync(src)) return undefined
  const dest = join(config.dataDir, 'media', `sample_${name}.jpg`)
  if (!existsSync(dest)) copyFileSync(src, dest)
  return `/api/media/sample_${name}.jpg`
}

let n = 0
const sid = (p: string) => `${p}_sample_${(n++).toString(36)}`

function sampleMoment(m: Omit<Moment, 'id' | 'eventIds' | 'feedback' | 'sample'>): Moment {
  const moment: Moment = { id: sid('mo'), eventIds: [], feedback: null, sample: true, ...m }
  moments.put(moment)
  return moment
}

export function seedSampleWeek() {
  const today = localDate(now())
  const parent = household.get().parentName
  // Deterministic "random" so every install shows the same believable week.
  const jitter = [4, 2, 11, 7, 3, 9, 5]
  for (let back = 6; back >= 1; back--) {
    const date = addDays(today, -back)
    const wd = weekdayOfDate(date)
    const j = jitter[back]
    for (const s of DEFAULT_SCHEDULES) {
      if (!s.days.includes(wd)) continue
      const id = `v_${s.id}_${date}`
      const expectedStart = atLocal(date, s.windowStart)
      const expectedEnd = atLocal(date, s.windowEnd)
      const missed = s.id === 's_aide' && back === 3
      const late = s.id === 's_aide' && back === 5
      const arrivedAt = missed ? undefined : expectedStart + (late ? 24 : j) * 60_000
      const minutes = s.id === 's_aide' ? 50 + (j % 7) : 4 + (j % 3)
      const departedAt = arrivedAt ? arrivedAt + minutes * 60_000 : undefined
      const visit: Visit = {
        id,
        scheduleId: s.id,
        label: s.label,
        who: s.who,
        date,
        expectedStart,
        expectedEnd,
        status: missed ? 'missed' : 'completed',
        arrivedAt,
        departedAt,
        minutes: arrivedAt ? minutes : undefined,
        lateByMin: arrivedAt ? Math.max(0, Math.round((arrivedAt - expectedEnd) / 60_000)) : undefined,
        evidence: arrivedAt
          ? [
              { kind: 'ring_motion', at: arrivedAt, detail: s.id === 's_aide' ? 'Someone in a care uniform with a bag (Front Door)' : 'Volunteer with an insulated food bag (Front Door)', snapshotUrl: sampleImage(s.id === 's_aide' ? 'aide_arrive' : 'meals') },
              ...(s.id === 's_aide' ? [{ kind: 'checkin_link' as const, at: arrivedAt + 60_000, detail: 'Maria tapped the check-in link, matching the doorbell arrival (2 signals)' }] : []),
            ]
          : [],
        sample: true,
      }
      visits.put(visit)
      const first = s.who.split(/[ (]/)[0]
      if (missed) {
        sampleMoment({ kind: 'visit_missed', severity: 'urgent', at: expectedEnd + s.graceMin * 60_000, title: `${s.label} missed`, body: `No one matching Maria's visit came to the door between ${clock(expectedStart)} and ${clock(expectedEnd + s.graceMin * 60_000)}. Priya called BrightCare: Maria was off sick and no cover was sent.`, visitId: id, ack: { by: 'Priya', at: expectedEnd + s.graceMin * 60_000 + 6 * 60_000 }, actions: ['call_parent', 'view_visit'] })
      } else {
        sampleMoment({ kind: 'visit_arrived', severity: 'calm', at: arrivedAt!, title: `${first === 'Meals' ? 'Meals on Wheels' : first} arrived`, body: `${s.label} started at ${clock(arrivedAt!)}${visit.lateByMin ? `, ${visit.lateByMin} min late` : ', on time'}.`, visitId: id, snapshotUrl: sampleImage(s.id === 's_aide' ? 'aide_arrive' : 'meals'), deviceName: 'Front Door', confidence: 0.92, ack: null, actions: ['view_visit'] })
        if (s.id === 's_aide') sampleMoment({ kind: 'visit_departed', severity: 'calm', at: departedAt!, title: "Maria's visit ended", body: `Maria was with ${parent} for ${minutes} min (${clock(arrivedAt!)}–${clock(departedAt!)}).`, visitId: id, snapshotUrl: sampleImage('aide_leave'), deviceName: 'Front Door', confidence: 0.88, ack: null, actions: ['view_visit'] })
      }
    }
    // A few other doorstep moments across the week.
    if (back === 6 || back === 2) {
      const at = atLocal(date, back === 6 ? '11:20' : '14:05')
      sampleMoment({ kind: 'delivery', severity: 'note', at, title: 'Delivery left at the door', body: 'A delivery driver left a medium cardboard box on the doormat.', snapshotUrl: sampleImage('courier'), deviceName: 'Front Door', confidence: 0.9, ack: null, actions: ['watch_live'] })
      if (back === 2) {
        sampleMoment({ kind: 'delivery_waiting', severity: 'heads_up', at: at + 31 * 60_000, title: 'Package still outside after 31 min', body: `Homebeat played a soft chime in ${parent}'s hallway as a reminder.`, snapshotUrl: sampleImage('package'), deviceName: 'Front Door', confidence: 0.86, ack: { by: 'Priya', at: at + 33 * 60_000 }, actions: ['play_chime', 'call_parent'] })
        sampleMoment({ kind: 'delivery_collected', severity: 'calm', at: at + 38 * 60_000, title: 'Package brought inside', body: 'The doorstep is clear again, 38 min after the delivery.', snapshotUrl: sampleImage('empty'), deviceName: 'Front Door', confidence: 0.93, ack: null })
      } else {
        sampleMoment({ kind: 'delivery_collected', severity: 'calm', at: at + 12 * 60_000, title: 'Package brought inside', body: 'The doorstep is clear again, 12 min after the delivery.', snapshotUrl: sampleImage('empty'), deviceName: 'Front Door', confidence: 0.91, ack: null })
      }
    }
    if (back % 2 === 0 || back === 5) {
      const out = atLocal(date, back === 4 ? '16:40' : '10:30')
      sampleMoment({ kind: 'resident_out', severity: 'calm', at: out, title: `${parent} went out`, body: `${parent} left with her handbag and walking cane. Getting out is a good sign.`, snapshotUrl: sampleImage('resident'), deviceName: 'Front Door', confidence: 0.84, ack: null })
      sampleMoment({ kind: 'resident_back', severity: 'calm', at: out + (55 + back * 4) * 60_000, title: `${parent} is back home`, body: `${parent} came back after about ${55 + back * 4} min.`, deviceName: 'Front Door', confidence: 0.8, ack: null })
    }
    sampleRawMotion(date, 30 + j * 3)
    if (back === 4) {
      const at = atLocal(date, '22:41')
      sampleMoment({ kind: 'after_dark', severity: 'urgent', at, title: `Someone at the door at ${clock(at)}`, body: 'An adult in a dark hooded jacket stood at the door for about a minute, then left. No visit was expected. Priya called Asha, who had not opened the door.', snapshotUrl: sampleImage('night'), deviceName: 'Front Door', confidence: 0.9, ack: { by: 'Priya', at: at + 3 * 60_000 }, actions: ['watch_live', 'call_parent'] })
    }
  }
}

// The everyday motion behind a sample day: about forty Ring events, almost all stopped by the free stages,
// so "How Homebeat watches" shows the funnel the way a real month looks. Deterministic, marked sample.
const STAGE_NAMES = ['Ring sub_type filter', 'Object gate (on-device)', 'Attire & vehicle match (on-device)', 'Vision model'] as const
const STOPS: { reach: 0 | 1 | 2 | 3; subType: string; summary: string }[] = [
  { reach: 0, subType: 'animal', summary: 'animal → skipped (not a care event)' },
  { reach: 0, subType: 'other_motion', summary: 'other_motion burst → merged with event 12 s earlier' },
  { reach: 0, subType: 'vehicle', summary: 'vehicle, no visit expected → passing traffic' },
  { reach: 1, subType: 'other_motion', summary: 'nothing detected → stop' },
  { reach: 1, subType: 'other_motion', summary: 'potted plant 0.62 → stop' },
  { reach: 0, subType: 'animal', summary: 'animal → skipped (not a care event)' },
  { reach: 1, subType: 'human', summary: 'only cat → stop' },
  { reach: 0, subType: 'other_motion', summary: 'other_motion burst → merged with event 19 s earlier' },
  { reach: 2, subType: 'human', summary: 'older adult at their own front door 0.81 → resolved, no vision model needed' },
  { reach: 1, subType: 'other_motion', summary: 'nothing detected → stop' },
  { reach: 2, subType: 'human', summary: 'person walking away from the house 0.77 → resolved, no vision model needed' },
  { reach: 0, subType: 'vehicle', summary: 'vehicle, no visit expected → passing traffic' },
]
function sampleRawMotion(date: string, count: number) {
  const dayStart = atLocal(date, '07:00')
  const span = atLocal(date, '21:30') - dayStart
  for (let i = 0; i < count; i++) {
    const at = dayStart + Math.round((span * (i + 0.5)) / count) + ((i * 7919) % 300) * 1000
    const stop = i % 17 === 9 ? { reach: 3 as const, subType: 'human', summary: 'A courier at the door holding a parcel.' } : STOPS[(i * 5 + date.length) % STOPS.length]
    const id = `ev_sample_${date}_${i}`
    events.put({ id, deviceId: 'sample-front-door', at, kind: 'motion', subType: stop.subType, source: 'sim', sample: true })
    const ms = [0, 520 + ((i * 37) % 180), 340 + ((i * 29) % 120), 2900 + ((i * 53) % 700)]
    const stages: StageResult[] = ([0, 1, 2, 3] as const).map((n) => ({
      stage: n,
      name: STAGE_NAMES[n],
      ran: n <= stop.reach,
      passed: n < stop.reach || (n === 3 && stop.reach === 3),
      ms: n <= stop.reach ? ms[n] : 0,
      costUsd: n === 3 && stop.reach === 3 ? config.ai.visionCallUsd : 0,
      summary: n === stop.reach ? stop.summary : n < stop.reach ? 'passed' : 'not needed',
    }))
    const a: Analysis = {
      id: `an_sample_${date}_${i}`,
      sample: true,
      eventId: id,
      deviceId: 'sample-front-door',
      startedAt: at,
      stages,
      verdict: { description: stop.reach >= 2 ? stop.summary : 'Filtered', confidence: stop.reach >= 2 ? 0.8 : 1 },
      totalMs: stages.reduce((sum, s) => sum + s.ms, 0),
      totalCostUsd: stages.reduce((sum, s) => sum + s.costUsd, 0),
    }
    analyses.put(a)
  }
}

// Demo helper (DEMO=1 only): wipe live data, re-seed, and open today's aide window two minutes from now,
// so a recording can show the whole arrival -> visit -> departure story in real time.
export function resetForDemo(opts: { aideInMinutes?: number } = {}) {
  for (const table of ['moments', 'visits', 'events', 'analyses', 'jobs', 'webhook_seen']) db.exec(`DELETE FROM ${table}`)
  for (const key of ['package_outstanding', 'notify_stats', 'history_baseline', 'sample_seeded']) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  schedules.all().forEach((s) => schedules.remove(s.id))
  rules.all().forEach((r) => rules.remove(r.id))
  seedIfEmpty()
  const start = new Date(now() + (opts.aideInMinutes ?? 2) * 60_000)
  const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: household.get().timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  const aide = schedules.get('s_aide')!
  schedules.put({ ...aide, days: [0, 1, 2, 3, 4, 5, 6], windowStart: hhmm(start), windowEnd: hhmm(new Date(start.getTime() + 15 * 60_000)) })
  setSetting('installed_at', now() - 60_000)
}
