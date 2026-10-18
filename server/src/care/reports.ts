// Daily digest (one calm paragraph instead of 40 alerts) and the weekly care report for siblings/agency.
import type { DailyDigest, FunnelStats, Moment, Visit, WeeklyReport } from '../../../shared/types.ts'
import { askJson, aiEnabled } from '../ai/provider.ts'
import { config } from '../config.ts'
import { getSetting } from '../db.ts'
import { analyses, events, household, moments } from '../store.ts'
import { addDays, atLocal, clock, localDate, weekdayOfDate } from '../time.ts'
import { ensureVisits } from './visits.ts'

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function momentsOn(date: string): Moment[] {
  const start = atLocal(date, '00:00')
  const end = atLocal(addDays(date, 1), '00:00')
  return moments.all('WHERE at >= ? AND at < ? ORDER BY at DESC', start, end)
}

function dayStats(date: string, ms: Moment[], visits: Visit[]) {
  return {
    visitsCompleted: visits.filter((v) => v.status === 'completed' || v.status === 'in_progress').length,
    visitsExpected: visits.length,
    deliveries: ms.filter((m) => m.kind === 'delivery').length,
    afterDark: ms.filter((m) => m.kind === 'after_dark').length,
    outings: ms.filter((m) => m.kind === 'resident_out').length,
  }
}

const digestCache = new Map<string, { key: string; digest: DailyDigest }>()

export async function dailyDigest(date: string): Promise<DailyDigest> {
  const ms = momentsOn(date).reverse()
  const visits = ensureVisits(date)
  const stats = dayStats(date, ms, visits)
  const parent = household.get().parentName
  const sample = ms.length > 0 && ms.every((m) => m.sample)
  const key = `${ms.length}:${ms.at(-1)?.id ?? ''}:${visits.map((v) => v.status).join(',')}`
  const cached = digestCache.get(date)
  if (cached?.key === key) return cached.digest

  const facts = [
    ...visits.map((v) => `${v.label} (${v.who}): ${v.status}${v.arrivedAt ? `, arrived ${clock(v.arrivedAt)}` : ''}${v.minutes ? `, ${v.minutes} min` : ''}${v.lateByMin ? `, ${v.lateByMin} min late` : ''}`),
    ...ms.filter((m) => !m.kind.startsWith('visit_')).map((m) => `${clock(m.at)} ${m.title}: ${m.body}`),
  ]
  let digest: DailyDigest = {
    date,
    headline: templateHeadline(date, stats, visits, parent),
    bullets: facts.slice(0, 6),
    stats,
    sample,
  }
  if (aiEnabled() && facts.length) {
    try {
      const out = await askJson<{ headline: string; bullets: string[] }>({
        system: `You write the end-of-day note in Homebeat, a care app for the family of ${parent}, an older person living alone. Warm, calm, factual, short. No exclamation marks. Never invent events.`,
        prompt: `Day: ${WEEKDAY[weekdayOfDate(date)]} ${date}.\nFacts:\n${facts.map((f) => `- ${f}`).join('\n')}\n\nReturn JSON {"headline": one sentence under 20 words summarising the day, "bullets": 2-5 short sentences, most important first}.`,
        model: 'text',
        maxTokens: 300,
      })
      digest = { ...digest, headline: out.headline, bullets: out.bullets.slice(0, 5) }
    } catch {
      /* keep the template digest */
    }
  }
  digestCache.set(date, { key, digest })
  return digest
}

function templateHeadline(date: string, s: ReturnType<typeof dayStats>, visits: Visit[], parent: string) {
  const day = WEEKDAY[weekdayOfDate(date)]
  const missed = visits.filter((v) => v.status === 'missed')
  if (missed.length) return `${day}: ${missed.map((v) => v.label).join(', ')} didn't happen.`
  if (s.afterDark) return `${day}: mostly calm, with ${s.afterDark} after-dark moment${s.afterDark > 1 ? 's' : ''} at the door.`
  if (s.visitsExpected) return `A calm ${day}. ${s.visitsCompleted} of ${s.visitsExpected} visits happened${s.outings ? ` and ${parent} went out` : ''}.`
  return `A quiet ${day} at ${parent}'s.`
}

export function weeklyReport(weekOf: string): WeeklyReport {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i))
  const byDay = days.map((date) => {
    const ms = momentsOn(date)
    const visits = ensureVisits(date)
    return { date, visits, deliveries: ms.filter((m) => m.kind === 'delivery').length, afterDark: ms.filter((m) => m.kind === 'after_dark').length, outings: ms.filter((m) => m.kind === 'resident_out').length }
  })
  const all = byDay.flatMap((d) => d.visits).filter((v) => v.expectedStart <= Date.now())
  const completed = all.filter((v) => v.status === 'completed' || v.status === 'in_progress')
  const late = completed.filter((v) => (v.lateByMin ?? 0) > 0)
  const missed = all.filter((v) => v.status === 'missed')
  const careMinutes = completed.reduce((sum, v) => sum + (v.minutes ?? 0), 0)
  const highlights: string[] = []
  if (all.length) highlights.push(`${completed.length} of ${all.length} expected visits happened; ${completed.length - late.length} on time.`)
  if (missed.length) highlights.push(`Missed: ${missed.map((v) => `${v.label} on ${WEEKDAY[weekdayOfDate(v.date)]}`).join(', ')}.`)
  if (careMinutes) highlights.push(`${Math.round(careMinutes / 60 * 10) / 10} hours of care at home this week.`)
  const outings = byDay.reduce((s, d) => s + d.outings, 0)
  if (outings) highlights.push(`${household.get().parentName} went out ${outings} time${outings > 1 ? 's' : ''}.`)
  const afterDark = byDay.reduce((s, d) => s + d.afterDark, 0)
  highlights.push(afterDark ? `${afterDark} after-dark moment${afterDark > 1 ? 's' : ''} at the door.` : 'No after-dark activity at the door.')
  return {
    weekOf,
    visits: { scheduled: all.length, completed: completed.length, onTime: completed.length - late.length, late: late.length, missed: missed.length, careMinutes },
    byDay,
    highlights,
    sample: all.length > 0 && all.every((v) => v.sample),
  }
}

export function funnelStats(days: number): FunnelStats {
  const since = Date.now() - days * 86_400_000
  const list = analyses.all('WHERE at >= ?', since)
  const ran = (n: number) => list.filter((a) => a.stages.some((s) => s.stage === n && s.ran)).length
  const raw = events.count('WHERE at >= ? AND kind != ?', since, 'on_demand')
  const ms = moments.all('WHERE at >= ?', since).filter((m) => !m.sample)
  return {
    windowDays: days,
    events: raw,
    stage1: ran(1),
    stage2: ran(2),
    stage3: ran(3),
    moments: ms.length,
    notified: getSetting('notify_stats', { notified: 0 }).notified,
    costUsd: list.reduce((s, a) => s + a.totalCostUsd, 0),
    naiveCostUsd: raw * config.ai.visionCallUsd,
  }
}

export const today = () => localDate(Date.now())
