// In-browser mock of the Homebeat backend. Used when VITE_MOCK=1, or automatically when /api/today fails.
import type {
  CompiledRule,
  DailyDigest,
  Moment,
  Rule,
  RuleAction,
  Schedule,
  Severity,
  StreamMessage,
  TodaySummary,
  Visit,
  WeeklyReport,
} from '@shared/types'
import type { HomebeatApi, StreamState } from '@/lib/api'
import { addDays, dateKey, formatClock, formatTime, now, setClockOffset, setHouseholdTz, todayKey, weekdayOf, zonedTime } from '@/lib/time'
import { buildWorld, DEMO_TIME, funnelStats, IMG, TZ, type World } from './fixtures'

let world: World | null = null
const listeners = new Set<(m: StreamMessage) => void>()

function init() {
  if (world) return world
  setHouseholdTz(TZ)
  // Pin the demo clock to "today at 2:20 PM" in Asha's timezone so the sample day always looks lived-in.
  const realNow = Date.now()
  // Land on the most recent Mon/Wed/Fri so the demo day has both Maria's visit and the lunch delivery.
  let demoDate = dateKey(realNow, TZ)
  while (![1, 3, 5].includes(weekdayOf(demoDate))) demoDate = addDays(demoDate, -1)
  const target = zonedTime(demoDate, DEMO_TIME, TZ)
  setClockOffset(target - realNow)
  world = buildWorld()
  return world
}

const delay = <T>(v: T, ms = 220 + Math.random() * 200) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms))
const emit = (m: StreamMessage) => listeners.forEach((fn) => fn(structuredClone(m)))
const notFound = (what: string) => Promise.reject(new Error(`${what} not found`))

function computeToday(w: World): TodaySummary {
  const t = todayKey()
  const n = now()
  const moments = w.moments.filter((m) => dateKey(m.at) === t)
  const visitsToday = w.visits.filter((v) => v.date === t)
  const nextVisit = w.visits
    .filter((v) => v.expectedStart > n && (v.status === 'upcoming' || v.status === 'due'))
    .sort((a, b) => a.expectedStart - b.expectedStart)[0]
  const openUrgent = moments.find((m) => m.severity === 'urgent' && !m.ack)
  const openHeads = moments.find((m) => m.severity === 'heads_up' && !m.ack)
  const aideToday = visitsToday.find((v) => v.scheduleId === 'sch-aide')
  let status: TodaySummary['status']
  if (openUrgent) status = { severity: 'urgent', headline: openUrgent.title, detail: openUrgent.body }
  else if (openHeads) status = { severity: 'heads_up', headline: openHeads.title, detail: openHeads.body }
  else
    status = {
      severity: 'calm',
      headline: `All calm at ${w.household.parentName}'s`,
      detail:
        aideToday?.arrivedAt && aideToday.departedAt
          ? `Maria's visit done · ${formatTime(aideToday.arrivedAt)}–${formatTime(aideToday.departedAt)}`
          : 'Nothing needs you right now',
    }
  const raw = (w.rawEventsByDay.get(t) ?? 30) + extraRaw
  return {
    household: w.household,
    status,
    nextVisit,
    visitsToday,
    moments,
    counts: { rawEvents: raw, moments: moments.length, notified: moments.filter((m) => m.severity === 'urgent' || m.severity === 'heads_up').length },
    devices: w.devices,
    lastSeenAt: moments.find((m) => m.kind !== 'quiet' && m.kind !== 'system')?.at,
  }
}
let extraRaw = 0

function compile(english: string): CompiledRule {
  const s = english.toLowerCase()
  const num = (re: RegExp, d: number) => {
    const m = s.match(re)
    return m ? Number(m[1]) : d
  }
  const time = (re: RegExp, d: string) => {
    const m = s.match(re)
    if (!m) return d
    let h = Number(m[1])
    const min = m[2] ? Number(m[2]) : 0
    const ap = m[3]
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (!ap && h < 7) h += 12
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }
  const who: RuleAction = /rohan|family|everyone|both|siblings?/.test(s) ? { type: 'notify', who: 'family' } : { type: 'notify', who: 'primary' }
  const tellWho = who.type === 'notify' && who.who === 'family' ? 'the whole family' : 'Priya'
  const chime = /chime|remind (her|asha|mum|mom)|nudge (her|asha)/.test(s)

  if (/package|parcel|deliver|box|bag/.test(s)) {
    const minutes = /hour/.test(s) ? num(/(\d+)\s*hour/, 1) * 60 : num(/(\d+)\s*min/, 30)
    const actions: RuleAction[] = [{ type: 'chime', slot: 'ring-appstore-event-1' }, who]
    return {
      template: 'package_waiting',
      summary: `If a package sits outside for more than ${minutes} minutes, play a soft chime for Asha and tell ${tellWho}.`,
      params: { minutes },
      actions,
      severity: 'heads_up',
    }
  }
  if (/night|dark|late|after \d|between \d|quiet hours/.test(s)) {
    const start = time(/(?:after|from|between)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/, '21:00')
    const end = time(/(?:until|till|to|and)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/, '06:30')
    const endFixed = end > '12:00' && !/(until|till|to|and)\s+\d+\s*pm/.test(s) ? '06:30' : end
    return {
      template: 'quiet_hours',
      summary: `If anyone comes to the door between ${formatClock(start)} and ${formatClock(endFixed)}, tell ${tellWho} right away and offer live view.`,
      params: { start, end: endFixed },
      actions: [who, { type: 'live_view' }],
      severity: 'urgent',
    }
  }
  if (/no one|nobody|no activity|hasn't|hasn’t|quiet|doesn't leave|doesn’t leave|not left/.test(s)) {
    const hours = num(/(\d+)\s*h/, 6)
    return {
      template: 'no_activity',
      summary: `If there is no door activity for ${hours} hours between 8:00 AM and 8:00 PM, suggest ${tellWho === 'Priya' ? 'Priya gives' : 'the family give'} Asha a call.`,
      params: { hours, from: '08:00', to: '20:00' },
      actions: [who],
      severity: 'note',
    }
  }
  if (/car|vehicle|van|truck/.test(s)) {
    const minutes = num(/(\d+)\s*min/, 15)
    return {
      template: 'unknown_vehicle',
      summary: `If an unfamiliar car stays in the driveway for more than ${minutes} minutes, tell ${tellWho}.`,
      params: { minutes },
      actions: [who],
      severity: 'heads_up',
    }
  }
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const days = dayNames.map((d, i) => (s.includes(d) || s.includes(d.slice(0, 3) + ' ') ? i : -1)).filter((i) => i >= 0)
  if (/comes|visit|nurse|aide|cleaner|arrive|every/.test(s)) {
    const start = time(/(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/, '10:00')
    const [h, m] = start.split(':').map(Number)
    const endM = h * 60 + m + 15
    const end = `${String(Math.floor(endM / 60)).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`
    const ds = days.length ? days : /weekday/.test(s) ? [1, 2, 3, 4, 5] : [weekdayOf(todayKey())]
    const whoName = english.match(/\b([A-Z][a-z]+)\b(?= (?:comes|visits|arrives|the))/)?.[1] ?? 'Visitor'
    return {
      template: 'expected_visit',
      summary: `Expect ${whoName} on ${ds.map((d) => dayNames[d].slice(0, 1).toUpperCase() + dayNames[d].slice(1, 3)).join(', ')} between ${formatClock(start)} and ${formatClock(end)}. If they're late or don't come, tell ${tellWho}.`,
      params: { who: whoName, days: ds, windowStart: start, windowEnd: end, graceMin: 30 },
      actions: [who, { type: 'escalate', afterMin: 30 }],
      severity: 'heads_up',
    }
  }
  return {
    template: 'custom_watch',
    summary: `When someone is at the door, Homebeat will check: “${english.replace(/^(tell me|let me know|alert me)\s+(if|when)\s+/i, '').replace(/\.$/, '')}”, and tell ${tellWho} if so.`,
    params: { question: english.replace(/\.$/, '') + (english.endsWith('?') ? '' : '?') },
    actions: chime ? [{ type: 'chime', slot: 'ring-appstore-event-1' }, who] : [who],
    severity: 'note',
  }
}

function digestFor(w: World, date: string): DailyDigest {
  const ms = w.moments.filter((m) => dateKey(m.at) === date)
  const vs = w.visits.filter((v) => v.date === date && v.expectedStart <= now())
  const completed = vs.filter((v) => v.status === 'completed' || v.status === 'late' || v.status === 'in_progress')
  const deliveries = ms.filter((m) => m.kind === 'delivery').length
  const afterDark = ms.filter((m) => m.kind === 'after_dark').length
  const outings = ms.filter((m) => m.kind === 'resident_out').length
  const wd = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
  const missed = vs.find((v) => v.status === 'missed')
  const late = vs.find((v) => v.status === 'late')
  const bullets: string[] = []
  for (const v of vs) {
    const name = v.scheduleId === 'sch-aide' ? 'Maria' : 'Meals on Wheels'
    if (v.status === 'missed') bullets.push(`${name} didn't come. Priya called BrightCare at 9:54 AM.`)
    else if (v.arrivedAt)
      bullets.push(
        `${name} arrived ${formatTime(v.arrivedAt)}${v.lateByMin ? ` (${v.lateByMin} min late)` : ''}${v.departedAt && v.minutes && v.minutes > 15 ? `, stayed ${v.minutes} min` : ''}.`,
      )
  }
  for (const m of ms.slice().reverse()) {
    if (m.kind === 'delivery') bullets.push(`${m.title} at ${formatTime(m.at)}.`)
    if (m.kind === 'after_dark') bullets.push(`Door activity after dark at ${formatTime(m.at)}${m.ack ? `, checked by ${m.ack.by}` : ''}.`)
    if (m.kind === 'resident_out') bullets.push(`Asha went out at ${formatTime(m.at)}.`)
    if (m.kind === 'quiet') bullets.push(`A long quiet stretch in the afternoon.`)
  }
  let headline = `A calm ${wd}.`
  if (missed) headline = `A ${wd} with a missed visit. Maria didn't come, and Priya followed up.`
  else if (afterDark) headline = `Mostly calm ${wd}, with someone at the door after dark.`
  else if (late) headline = `A calm ${wd}. Maria came a little late.`
  else if (completed.length && outings) headline = `A calm ${wd}. Maria came on time and Asha went for her walk.`
  else if (completed.length) headline = `A calm ${wd}. Every visit happened as expected.`
  else if (ms.some((m) => m.kind === 'quiet')) headline = `A quiet ${wd} at home.`
  if (!bullets.length) bullets.push('Nothing at the door worth mentioning.')
  return {
    date,
    headline,
    bullets,
    stats: { visitsCompleted: completed.length, visitsExpected: vs.length, deliveries, afterDark, outings },
    sample: true,
  }
}

function reportFor(w: World, weekOf: string): WeeklyReport {
  const byDay: WeeklyReport['byDay'] = []
  const all: Visit[] = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekOf, i)
    const vs = w.visits.filter((v) => v.date === date)
    all.push(...vs.filter((v) => v.expectedStart <= now()))
    const ms = w.moments.filter((m) => dateKey(m.at) === date)
    byDay.push({
      date,
      visits: vs,
      deliveries: ms.filter((m) => m.kind === 'delivery').length,
      afterDark: ms.filter((m) => m.kind === 'after_dark').length,
      outings: ms.filter((m) => m.kind === 'resident_out').length,
    })
  }
  const done = all.filter((v) => v.status === 'completed' || v.status === 'late' || v.status === 'in_progress')
  const careMinutes = done.reduce((s, v) => s + (v.minutes ?? 0), 0)
  const late = all.filter((v) => v.status === 'late').length
  const missed = all.filter((v) => v.status === 'missed').length
  return {
    weekOf,
    visits: { scheduled: all.length, completed: done.length, onTime: done.length - late, late, missed, careMinutes },
    byDay,
    highlights: weekHighlights(w, weekOf, careMinutes, missed),
    sample: true,
  }
}

function weekHighlights(w: World, weekOf: string, careMinutes: number, missed: number) {
  const inWeek = w.moments.filter((m) => dateKey(m.at) >= weekOf && dateKey(m.at) <= addDays(weekOf, 6))
  const out: string[] = [
    `Maria spent about ${Math.round(careMinutes / 60)} hours with Asha this week${missed ? ', with one missed visit that Priya followed up with BrightCare' : ''}.`,
  ]
  const meals = w.visits.filter((v) => v.scheduleId === 'sch-meals' && v.date >= weekOf && v.date <= addDays(weekOf, 6) && v.expectedStart <= now())
  if (meals.length) out.push(meals.every((v) => v.arrivedAt) ? 'Meals on Wheels came every scheduled day.' : 'Meals on Wheels missed a day.')
  for (const m of inWeek.filter((x) => x.kind === 'after_dark')) {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TZ }).format(m.at)
    out.push(`Someone at the door after dark on ${day} at ${formatTime(m.at)}${m.ack ? `. ${m.ack.by} checked it within ${Math.max(1, Math.round((m.ack.at - m.at) / 60000))} minutes` : ''}.`)
  }
  const walks = inWeek.filter((x) => x.kind === 'resident_out').length
  if (walks) out.push(`Asha went out for her morning walk ${walks === 1 ? 'once' : `${walks} times`}.`)
  return out
}

// --- simulated live events (dev "simulate event" button) ---
const SIMS: { kind: Moment['kind']; severity: Severity; title: string; body: string; img?: string; actions?: Moment['actions']; confidence?: number }[] = [
  {
    kind: 'visitor',
    severity: 'heads_up',
    title: 'Someone unexpected at the door',
    body: 'A person rang the bell. No visit is expected right now, and it looks like a salesperson with a clipboard.',
    img: IMG.delivery,
    actions: ['watch_live', 'call_parent', 'mark_handled'],
    confidence: 0.71,
  },
  {
    kind: 'after_dark',
    severity: 'urgent',
    title: 'Someone at the door after dark',
    body: 'A person is at the front door during Asha’s quiet hours and hasn’t rung the bell.',
    img: IMG.night,
    actions: ['watch_live', 'call_parent', 'mark_handled'],
    confidence: 0.78,
  },
  {
    kind: 'delivery',
    severity: 'note',
    title: 'Parcel at the door',
    body: 'A courier left a box on the doormat. Homebeat will check again in 30 minutes.',
    img: IMG.package,
    actions: ['play_chime', 'call_parent'],
    confidence: 0.9,
  },
]
let simIdx = 0

export function simulate(kind?: 'urgent' | 'heads_up' | 'calm') {
  const w = init()
  const pick = kind === 'urgent' ? SIMS[1] : kind === 'heads_up' ? SIMS[0] : kind === 'calm' ? SIMS[2] : SIMS[simIdx++ % SIMS.length]
  const m: Moment = {
    id: `mo-sim-${Date.now().toString(36)}`,
    kind: pick.kind,
    severity: pick.severity,
    at: now(),
    title: pick.title,
    body: pick.body,
    deviceId: 'dev-front',
    deviceName: 'Front Door',
    snapshotUrl: pick.img,
    eventIds: [`ev-sim-${Date.now().toString(36)}`],
    confidence: pick.confidence,
    actions: pick.actions,
    ack: null,
    feedback: null,
    sample: true,
  }
  // reuse a similar trace
  const similar = w.moments.find((x) => x.kind === pick.kind && x.analysisId) ?? w.moments.find((x) => x.analysisId)
  if (similar?.analysisId) {
    const base = w.analyses.get(similar.analysisId)!
    const a = { ...structuredClone(base), id: `an-sim-${Date.now().toString(36)}`, eventId: m.eventIds[0], startedAt: m.at - 3500, snapshotUrl: m.snapshotUrl }
    a.verdict.description = pick.body
    a.verdict.visitorType = pick.kind === 'delivery' ? 'delivery' : 'unknown'
    a.verdict.confidence = pick.confidence ?? a.verdict.confidence
    w.analyses.set(a.id, a)
    m.analysisId = a.id
  }
  w.moments.unshift(m)
  extraRaw += 3
  emit({ type: 'event', eventId: m.eventIds[0], deviceId: 'dev-front', subType: 'human', at: m.at })
  emit({ type: 'moment', moment: m })
  emit({ type: 'status', status: computeToday(w).status })
}

function updateMoment(id: string, patch: Partial<Moment>) {
  const w = init()
  const m = w.moments.find((x) => x.id === id)
  if (!m) return null
  Object.assign(m, patch)
  emit({ type: 'moment_updated', moment: m })
  emit({ type: 'status', status: computeToday(w).status })
  return m
}

export function createMockApi(): HomebeatApi {
  const w = init()
  return {
    today: () => delay(computeToday(w), 350),
    moments: (date) => delay(w.moments.filter((m) => dateKey(m.at) === date)),
    ack: (id, by) => {
      const m = updateMoment(id, { ack: { by, at: now() } })
      return m ? delay(m, 250) : notFound('Moment')
    },
    feedback: (id, feedback) => {
      const m = updateMoment(id, { feedback })
      return m ? delay(m, 200) : notFound('Moment')
    },
    chime: () => delay({ ok: true, slot: 'ring-appstore-event-1' }, 700),
    visits: (from, to) => delay(w.visits.filter((v) => v.date >= from && v.date <= to)),
    schedules: () => delay(w.schedules),
    createSchedule: (s) => {
      const created: Schedule = { ...s, id: `sch-${Date.now().toString(36)}`, checkinCode: s.checkinCode ?? Math.random().toString(36).slice(2, 8) }
      w.schedules.push(created)
      return delay(created)
    },
    updateSchedule: (s) => {
      const i = w.schedules.findIndex((x) => x.id === s.id)
      if (i < 0) return notFound('Schedule')
      w.schedules[i] = s
      return delay(s)
    },
    deleteSchedule: (id) => {
      w.schedules = w.schedules.filter((s) => s.id !== id)
      return delay({ ok: true as const })
    },
    rules: () => delay(w.rules),
    compileRule: (english) => delay(compile(english), 900 + Math.random() * 500),
    createRule: (english, compiled) => {
      const r: Rule = { id: `rule-${Date.now().toString(36)}`, english, compiled, enabled: true, createdAt: now(), fireCount: 0 }
      w.rules.unshift(r)
      return delay(r)
    },
    setRuleEnabled: (id, enabled) => {
      const r = w.rules.find((x) => x.id === id)
      if (!r) return notFound('Rule')
      r.enabled = enabled
      return delay(r, 150)
    },
    deleteRule: (id) => {
      w.rules = w.rules.filter((r) => r.id !== id)
      return delay({ ok: true as const })
    },
    devices: () => delay(w.devices),
    refreshDevices: () => delay(w.devices, 800),
    startLive: () => Promise.reject(new Error('Live view needs the Homebeat server.')),
    stopLive: () => delay({ ok: true as const }, 50),
    analysis: (id) => {
      const a = w.analyses.get(id)
      return a ? delay(a, 300) : notFound('Analysis')
    },
    funnel: (days = 30) => delay(funnelStats(days)),
    digest: (date) => delay(digestFor(w, date)),
    report: (weekOf) => delay(reportFor(w, weekOf)),
    household: () => delay(w.household),
    updateHousehold: (patch) => {
      Object.assign(w.household, patch)
      return delay(w.household)
    },
    setupStatus: () => delay({ mode: w.household.ringMode, tokenExpiresAt: w.household.tokenExpiresAt, accountLinked: true, devices: w.devices }),
    setToken: (token) => {
      if (token.trim().length < 12) return delay({ ok: false, devices: [], error: 'That token looks too short. Copy the whole token from the Ring Developer Playground.' }, 600)
      w.household.tokenExpiresAt = now() + 12 * 3600_000
      emit({ type: 'ring', mode: w.household.ringMode, tokenExpiresAt: w.household.tokenExpiresAt })
      return delay({ ok: true, devices: w.devices }, 900)
    },
    checkin: (code) => {
      const s = w.schedules.find((x) => x.checkinCode === code)
      return delay(s ? { ok: true, who: s.who.split(' (')[0] } : { ok: false }, 700)
    },
    checkinInfo: (code) => {
      const s = w.schedules.find((x) => x.checkinCode === code)
      return s ? delay({ who: s.who.split(' (')[0], parentName: w.household.parentName }, 300) : Promise.reject(Object.assign(new Error('Unknown link'), { status: 404 }))
    },
    simEvent: () => Promise.reject(new Error('The simulator only runs on the Homebeat server.')),
    subscribe(onMessage, onState?: (s: StreamState) => void) {
      onState?.('connecting')
      const t = setTimeout(() => onState?.('open'), 400)
      listeners.add(onMessage)
      return () => {
        clearTimeout(t)
        listeners.delete(onMessage)
      }
    },
  }
}
