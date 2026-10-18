// Rich, deterministic sample data for mock mode. Follows shared/types.ts exactly; every record has sample: true.
import type {
  Analysis,
  Device,
  FunnelStats,
  Household,
  Moment,
  MomentKind,
  Rule,
  Schedule,
  Severity,
  StageResult,
  Visit,
  VisitEvidence,
  VisitorType,
} from '@shared/types'
import { addDays, formatTime, now, weekdayOf, zonedTime, todayKey } from '@/lib/time'

export const TZ = 'America/Los_Angeles'
/** The mock's demo clock: "today at 2:20 PM" in Asha's timezone. */
export const DEMO_TIME = '14:20'

export const IMG = {
  aide: '/placeholders/door-aide.svg',
  package: '/placeholders/door-package.svg',
  delivery: '/placeholders/door-delivery.svg',
  night: '/placeholders/door-night.svg',
  car: '/placeholders/driveway-car.svg',
  empty: '/placeholders/door-empty.svg',
}

export interface World {
  household: Household
  schedules: Schedule[]
  devices: Device[]
  visits: Visit[]
  moments: Moment[]
  analyses: Map<string, Analysis>
  rules: Rule[]
  rawEventsByDay: Map<string, number>
}

const H = 3600_000
const M = 60_000

export function buildWorld(): World {
  const today = todayKey()
  const at = (date: string, hhmm: string) => zonedTime(date, hhmm, TZ)
  const n = now()

  const household: Household = {
    id: 'hh-asha',
    parentName: 'Asha',
    homeName: "Asha's home",
    timezone: TZ,
    members: [
      { id: 'm-priya', name: 'Priya', relation: 'Daughter', role: 'primary', escalationOrder: 1, phone: '+1 555 0177' },
      { id: 'm-rohan', name: 'Rohan', relation: 'Son', role: 'family', escalationOrder: 2, phone: '+1 555 0193' },
      { id: 'm-linda', name: 'Linda', relation: 'Neighbor', role: 'viewer', escalationOrder: 3 },
    ],
    quietHours: { start: '21:00', end: '06:30' },
    parentPhone: '+1 555 0142',
    escalateAfterMin: 10,
    consent: { by: 'Asha', at: zonedTime(addDays(today, -21), '10:30', TZ), note: 'Asha chose which cameras Homebeat can see and can pause it any time.' },
    plan: { name: 'Homebeat Family', trialDays: 30, trialEndsAt: n + 23 * 24 * H },
    ringMode: 'playground',
    ringAccountId: 'ring-acct-4821',
    tokenExpiresAt: n + 9 * H + 20 * M,
  }

  const schedules: Schedule[] = [
    {
      id: 'sch-aide',
      label: 'Home aide',
      who: 'Maria (BrightCare)',
      visitorType: 'care_worker',
      days: [1, 2, 3, 4, 5],
      windowStart: '09:00',
      windowEnd: '09:15',
      graceMin: 30,
      expectedMinutes: 55,
      vehicleHint: 'silver hatchback',
      checkinCode: 'maria-7q4k',
      active: true,
    },
    {
      id: 'sch-meals',
      label: 'Lunch delivery',
      who: 'Meals on Wheels',
      visitorType: 'delivery',
      days: [1, 3, 5],
      windowStart: '12:00',
      windowEnd: '12:30',
      graceMin: 30,
      expectedMinutes: 10,
      checkinCode: 'meals-2b9x',
      active: true,
    },
  ]

  const devices: Device[] = [
    {
      id: 'dev-front',
      name: 'Front Door',
      kind: 'doorbell',
      online: true,
      battery: 82,
      encrypted: false,
      privacyZones: 1,
      motionZones: 3,
      maxLiveSeconds: 30,
      lastEventAt: at(today, '12:19'),
    },
    {
      id: 'dev-drive',
      name: 'Driveway',
      kind: 'camera',
      online: true,
      battery: null,
      encrypted: false,
      privacyZones: 0,
      motionZones: 2,
      maxLiveSeconds: 60,
      lastEventAt: at(today, '13:02'),
    },
    {
      id: 'dev-chime',
      name: 'Hallway Chime',
      kind: 'chime',
      online: true,
      chimeSlots: [
        { event: 'ring-appstore-event-1', name: 'Soft reminder', disabled: false },
        { event: 'ring-appstore-event-2', name: 'Attention tone', disabled: false },
      ],
    },
  ]

  const visits: Visit[] = []
  const moments: Moment[] = []
  const analyses = new Map<string, Analysis>()
  let seq = 0
  const id = (p: string) => `${p}-${(++seq).toString(36).padStart(3, '0')}`

  // --- analysis helper: build a believable funnel trace for a moment ---
  function trace(
    m: Moment,
    o: {
      subType?: 'human' | 'motion' | 'ding' | 'vehicle' | 'package'
      objects?: string
      vehicle?: string | null
      vision?: string | null
      visitorType?: VisitorType
      activity?: Analysis['verdict']['activity']
      packagePresent?: boolean
      confidence?: number
    },
  ) {
    const aid = id('an')
    const stages: StageResult[] = [
      {
        stage: 0,
        name: 'Ring sub_type filter',
        ran: true,
        passed: true,
        ms: 1,
        costUsd: 0,
        summary: `${o.subType ?? 'human'} → process`,
        detail: { sub_type: o.subType ?? 'human' },
      },
      {
        stage: 1,
        name: 'Object gate',
        ran: true,
        passed: true,
        ms: 34 + (seq % 17),
        costUsd: 0,
        summary: o.objects ?? 'person 0.93',
      },
      o.vehicle === undefined
        ? { stage: 2, name: 'Known-vehicle match', ran: false, passed: true, ms: 0, costUsd: 0, summary: 'No car in view, not needed' }
        : {
            stage: 2,
            name: 'Known-vehicle match',
            ran: true,
            passed: o.vehicle === null,
            ms: 21 + (seq % 9),
            costUsd: 0,
            summary: o.vehicle ? `${o.vehicle}, matches a known visitor` : 'No known vehicle, sent on',
          },
      o.vision
        ? { stage: 3, name: 'Vision model', ran: true, passed: true, ms: 1180 + (seq % 7) * 61, costUsd: 0.0061, summary: o.vision }
        : { stage: 3, name: 'Vision model', ran: false, passed: true, ms: 0, costUsd: 0, summary: 'Earlier stages were sure enough, not needed' },
    ]
    const a: Analysis = {
      id: aid,
      eventId: m.eventIds[0],
      deviceId: m.deviceId ?? 'dev-front',
      startedAt: m.at - 4000,
      stages,
      verdict: {
        visitorType: o.visitorType,
        activity: o.activity ?? 'unknown',
        packagePresent: o.packagePresent,
        vehicle: o.vehicle ?? null,
        description: o.vision ?? o.objects ?? m.body,
        confidence: o.confidence ?? m.confidence ?? 0.9,
      },
      snapshotUrl: m.snapshotUrl,
      totalMs: stages.reduce((s, x) => s + x.ms, 0),
      totalCostUsd: stages.reduce((s, x) => s + x.costUsd, 0),
    }
    analyses.set(aid, a)
    m.analysisId = aid
  }

  function moment(
    kind: MomentKind,
    severity: Severity,
    t: number,
    title: string,
    body: string,
    extra: Partial<Moment> = {},
  ): Moment {
    const m: Moment = {
      id: id('mo'),
      kind,
      severity,
      at: t,
      title,
      body,
      deviceId: 'dev-front',
      deviceName: 'Front Door',
      eventIds: [id('ev')],
      feedback: null,
      ack: null,
      sample: true,
      ...extra,
    }
    moments.push(m)
    return m
  }

  // --- visits ---
  type Outcome = { kind: 'on_time' | 'late' | 'missed'; arrive?: string; minutes?: number }
  const aideOutcomes: Outcome[] = [
    { kind: 'on_time', arrive: '09:07', minutes: 56 },
    { kind: 'late', arrive: '09:31', minutes: 50 },
    { kind: 'on_time', arrive: '09:02', minutes: 58 },
    { kind: 'missed' },
    { kind: 'on_time', arrive: '09:10', minutes: 52 },
    { kind: 'on_time', arrive: '09:05', minutes: 55 },
  ]
  const mealsOutcomes: Outcome[] = [
    { kind: 'on_time', arrive: '12:21', minutes: 4 },
    { kind: 'on_time', arrive: '12:09', minutes: 6 },
    { kind: 'late', arrive: '12:52', minutes: 5 },
    { kind: 'on_time', arrive: '12:17', minutes: 5 },
  ]
  const outcomeIdx: Record<string, number> = { 'sch-aide': 0, 'sch-meals': 0 }
  const fmtHM = (t: number) => formatTime(t)

  for (let offset = -6; offset <= 6; offset++) {
    const date = addDays(today, offset)
    const wd = weekdayOf(date)
    for (const s of schedules) {
      if (!s.days.includes(wd)) continue
      const expectedStart = at(date, s.windowStart)
      const expectedEnd = at(date, s.windowEnd)
      const v: Visit = {
        id: `vi-${s.id.slice(4)}-${date}`,
        scheduleId: s.id,
        label: s.label,
        who: s.who,
        date,
        expectedStart,
        expectedEnd,
        status: 'upcoming',
        evidence: [],
        sample: true,
      }
      visits.push(v)
      if (offset > 0) continue
      const isAide = s.id === 'sch-aide'
      const short = isAide ? 'Maria' : 'Meals on Wheels'
      let o: Outcome
      if (offset === 0) {
        o = isAide ? { kind: 'on_time', arrive: '09:04', minutes: 54 } : { kind: 'on_time', arrive: '12:14', minutes: 5 }
      } else {
        const list = isAide ? aideOutcomes : mealsOutcomes
        o = list[outcomeIdx[s.id]++ % list.length]
      }
      if (o.kind === 'missed') {
        v.status = 'missed'
        const lateM = moment('visit_late', 'heads_up', expectedEnd + M, `${short} is running late`,
          `${short} usually arrives by ${fmtHM(expectedEnd)}. Homebeat is keeping an eye out and will tell you when she's there.`,
          { visitId: v.id, actions: ['call_parent', 'view_visit'], ack: { by: 'Priya', at: expectedEnd + 6 * M } })
        trace(lateM, { subType: 'motion', objects: 'no person at the door', vision: null })
        const missT = expectedEnd + s.graceMin * M
        const miss = moment('visit_missed', 'urgent', missT, `${short}'s visit didn't happen`,
          `No one from BrightCare came to the door between ${fmtHM(expectedStart)} and ${fmtHM(missT)}. It may be worth calling BrightCare, or checking in with Asha.`,
          { visitId: v.id, snapshotUrl: IMG.empty, actions: ['call_parent', 'view_visit', 'mark_handled'], ack: { by: 'Priya', at: missT + 9 * M } })
        trace(miss, { subType: 'motion', objects: 'no person at the door', vision: null })
        v.evidence.push({ kind: 'ring_motion', at: expectedStart + 22 * M, detail: 'Only a passing car on the Driveway camera during the window' })
        continue
      }
      const arrive = at(date, o.arrive!)
      const depart = arrive + o.minutes! * M
      const lateBy = Math.max(0, Math.round((arrive - expectedEnd) / M))
      v.arrivedAt = arrive
      v.minutes = o.minutes
      v.status = o.kind === 'late' ? 'late' : 'completed'
      if (o.kind === 'late') v.lateByMin = lateBy
      if (depart > n) {
        v.status = 'in_progress'
        v.minutes = undefined
      } else {
        v.departedAt = depart
      }
      const ev: VisitEvidence[] = []
      if (isAide) {
        ev.push({ kind: 'vehicle_match', at: arrive - 2 * M, detail: 'Silver hatchback parked in the driveway, matches Maria’s car', snapshotUrl: IMG.car })
        ev.push({ kind: 'ring_ding', at: arrive, detail: 'Doorbell pressed at the Front Door' })
        ev.push({ kind: 'vision', at: arrive + 4000, detail: 'Care worker in scrubs with a shoulder bag at the door', snapshotUrl: IMG.aide })
        ev.push({ kind: 'checkin_link', at: arrive + M, detail: 'Maria tapped “I’m here” on her check-in link' })
        if (v.departedAt) ev.push({ kind: 'ring_motion', at: depart, detail: 'Person leaving by the Front Door' })
      } else {
        ev.push({ kind: 'ring_motion', at: arrive, detail: 'Person at the Front Door' })
        ev.push({ kind: 'vision', at: arrive + 4000, detail: 'Delivery driver carrying an insulated meal bag', snapshotUrl: IMG.delivery })
        ev.push({ kind: 'ring_ding', at: arrive + 30_000, detail: 'Doorbell pressed, Asha answered' })
      }
      v.evidence = ev

      if (o.kind === 'late') {
        const lm = moment('visit_late', 'heads_up', expectedEnd + M, `${short} is running late`,
          `${short} usually arrives by ${fmtHM(expectedEnd)}. Homebeat is keeping an eye out and will tell you when ${isAide ? 'she' : 'they'} arrive${isAide ? 's' : ''}.`,
          { visitId: v.id, actions: ['view_visit', 'call_parent'] })
        trace(lm, { subType: 'motion', objects: 'no person at the door' })
      }
      if (isAide) {
        const am = moment('visit_arrived', 'calm', arrive,
          o.kind === 'late' ? `Maria arrived, ${lateBy} min late` : 'Maria arrived',
          o.kind === 'late'
            ? `Maria from BrightCare got to Asha's at ${fmtHM(arrive)}. She rang the bell and checked in.`
            : `Maria from BrightCare arrived at ${fmtHM(arrive)}, right on time. She rang the bell and checked in.`,
          { visitId: v.id, snapshotUrl: IMG.aide, confidence: 0.94, actions: ['view_visit'] })
        trace(am, { subType: 'ding', objects: 'person 0.95, car 0.88', vehicle: 'silver hatchback', vision: 'Care worker arriving with a shoulder bag', visitorType: 'care_worker', activity: 'arriving', confidence: 0.94 })
        if (v.departedAt) {
          const dm = moment('visit_departed', 'calm', depart, "Maria's visit is done",
            `Maria left at ${fmtHM(depart)} after ${o.minutes} minutes with Asha.`,
            { visitId: v.id, actions: ['view_visit'] })
          trace(dm, { subType: 'human', objects: 'person 0.91', vision: 'Care worker leaving, walking to the driveway', visitorType: 'care_worker', activity: 'leaving', confidence: 0.91 })
        }
      } else {
        const mm = moment('visit_arrived', 'calm', arrive,
          o.kind === 'late' ? `Lunch arrived, ${lateBy} min late` : 'Lunch delivered',
          `Meals on Wheels dropped off lunch at ${fmtHM(arrive)} and Asha came to the door.`,
          { visitId: v.id, snapshotUrl: IMG.delivery, confidence: 0.9, actions: ['view_visit'] })
        trace(mm, { subType: 'human', objects: 'person 0.92, bag 0.71', vision: 'Delivery driver handing over an insulated meal bag', visitorType: 'delivery', activity: 'delivering', confidence: 0.9 })
      }
    }
  }

  // --- the rest of each day ---
  const d = (o: number) => addDays(today, o)

  // Today
  {
    const t = d(0)
    const out = moment('resident_out', 'calm', at(t, '07:42'), 'Asha went out for her walk', 'Asha left by the front door at 7:42 AM.', { confidence: 0.86 })
    trace(out, { subType: 'human', objects: 'person 0.94', vision: 'Older woman with a walking stick leaving the porch', visitorType: 'resident', activity: 'leaving', confidence: 0.86 })
    const back = moment('resident_back', 'calm', at(t, '08:21'), 'Asha is back home', 'Asha came back after 39 minutes.', { confidence: 0.86 })
    trace(back, { subType: 'human', objects: 'person 0.93', vision: 'Older woman with a walking stick coming up the steps', visitorType: 'resident', activity: 'arriving', confidence: 0.86 })
    const del = moment('delivery', 'note', at(t, '11:20'), 'Pharmacy delivery at the door', 'A pharmacy bag and a small box were left on the doormat at 11:20 AM.', {
      snapshotUrl: IMG.package, confidence: 0.92, actions: ['play_chime', 'call_parent'],
    })
    trace(del, { subType: 'human', objects: 'person 0.90, package 0.84', vision: 'Courier leaving a white pharmacy bag and a box on the mat', visitorType: 'delivery', activity: 'delivering', packagePresent: true, confidence: 0.92 })
    const wait = moment('delivery_waiting', 'heads_up', at(t, '11:50'), 'Pharmacy bag still outside',
      'Still outside after 30 min. Homebeat played a soft chime inside to remind Asha.', {
        snapshotUrl: IMG.package, ruleId: 'rule-pkg', actions: ['play_chime', 'call_parent', 'mark_handled'], ack: { by: 'Priya', at: at(t, '11:53') },
      })
    trace(wait, { subType: 'motion', objects: 'package 0.86', vision: 'Pharmacy bag and box still on the doormat', packagePresent: true, activity: 'waiting', confidence: 0.93 })
    const col = moment('delivery_collected', 'calm', at(t, '12:05'), 'Asha brought the pharmacy bag inside', 'The doormat is clear again. Nothing to do.', { snapshotUrl: IMG.empty })
    trace(col, { subType: 'human', objects: 'person 0.92, package 0.61', vision: 'Resident picking up the bag and going inside', visitorType: 'resident', activity: 'collecting', packagePresent: false, confidence: 0.9 })
  }
  // Yesterday
  {
    const t = d(-1)
    const vis = moment('visitor', 'calm', at(t, '10:31'), 'A visitor at the door', 'Someone rang the bell at 10:31 AM and Asha answered. Looks like a family visit.', {
      confidence: 0.68, snapshotUrl: IMG.empty, actions: ['call_parent'],
    })
    trace(vis, { subType: 'ding', objects: 'person 0.92', vehicle: null, vision: 'Adult with flowers greeting someone at the door', visitorType: 'family', activity: 'arriving', confidence: 0.68 })
    const q = moment('quiet', 'note', at(t, '16:40'), 'A quiet afternoon at the door', 'No one has come or gone since 11:52 AM, longer than usual for a Sunday. Maybe give Asha a call?', {
      actions: ['call_parent', 'mark_handled'], eventIds: [], deviceId: undefined, deviceName: undefined,
    })
    q.eventIds = []
  }
  // 2 days ago
  {
    const t = d(-2)
    const g = moment('delivery', 'note', at(t, '13:12'), 'Groceries delivered', 'Two grocery bags were left at the door. Asha brought them in 6 minutes later.', { snapshotUrl: IMG.package, confidence: 0.9 })
    trace(g, { subType: 'human', objects: 'person 0.91, package 0.88', vision: 'Courier setting down two grocery bags', visitorType: 'delivery', activity: 'delivering', packagePresent: true, confidence: 0.9 })
    const ad = moment('after_dark', 'urgent', at(t, '22:47'), 'Someone at the door after dark',
      'A person was at the front door at 10:47 PM, during Asha’s quiet hours. They left after about 2 minutes without ringing.', {
        snapshotUrl: IMG.night, confidence: 0.74, actions: ['watch_live', 'call_parent', 'mark_handled'], ack: { by: 'Priya', at: at(t, '22:51') }, feedback: 'right',
      })
    trace(ad, { subType: 'human', objects: 'person 0.81', vehicle: null, vision: 'Adult standing by the door at night, no package', visitorType: 'unknown', activity: 'waiting', confidence: 0.74 })
  }
  // 3 days ago
  {
    const t = d(-3)
    const b = moment('delivery', 'note', at(t, '15:05'), 'Parcel at the door', 'A courier left a box on the doormat. Asha took it in at 3:40 PM.', { snapshotUrl: IMG.package, confidence: 0.88 })
    trace(b, { subType: 'package', objects: 'person 0.87, package 0.9', vision: 'Courier leaving a cardboard box', visitorType: 'delivery', activity: 'delivering', packagePresent: true, confidence: 0.88 })
  }
  // 4 days ago
  {
    const t = d(-4)
    const ad = moment('after_dark', 'heads_up', at(t, '21:34'), 'Late delivery at the door', 'A courier left a parcel at 9:34 PM, just inside quiet hours. Asha’s door stayed closed.', {
      snapshotUrl: IMG.night, confidence: 0.72, actions: ['watch_live', 'mark_handled'], ack: { by: 'Rohan', at: at(t, '21:40') },
    })
    trace(ad, { subType: 'human', objects: 'person 0.83, package 0.66', vehicle: null, vision: 'Person in a reflective vest placing a box by the door', visitorType: 'delivery', activity: 'delivering', packagePresent: true, confidence: 0.72 })
  }
  // 5 days ago
  {
    const t = d(-5)
    const s = moment('system', 'note', at(t, '14:02'), 'Driveway camera was offline briefly', 'It reconnected on its own after 18 minutes. Nothing was missed at the front door.', {
      deviceId: 'dev-drive', deviceName: 'Driveway', eventIds: [],
    })
    void s
  }
  // 6 days ago
  {
    const t = d(-6)
    const v = moment('vehicle', 'note', at(t, '17:40'), 'A car parked in the driveway', 'An unfamiliar car parked for 12 minutes and then left. No one came to the door.', {
      deviceId: 'dev-drive', deviceName: 'Driveway', snapshotUrl: IMG.car, confidence: 0.81,
    })
    trace(v, { subType: 'vehicle', objects: 'car 0.96', vehicle: null, vision: 'Hatchback parked, driver stayed inside', activity: 'waiting', confidence: 0.81 })
  }

  moments.sort((a, b) => b.at - a.at)

  const rules: Rule[] = [
    {
      id: 'rule-pkg',
      english: 'Tell me if a package sits outside more than 30 minutes',
      compiled: {
        template: 'package_waiting',
        summary: 'If a package sits outside for more than 30 minutes, play a soft chime for Asha and tell Priya.',
        params: { minutes: 30 },
        actions: [{ type: 'chime', slot: 'ring-appstore-event-1' }, { type: 'notify', who: 'primary' }],
        severity: 'heads_up',
      },
      enabled: true,
      createdAt: n - 21 * 24 * H,
      lastFiredAt: at(today, '11:50'),
      fireCount: 6,
    },
    {
      id: 'rule-night',
      english: 'Let me know about anyone at the door after 9 at night',
      compiled: {
        template: 'quiet_hours',
        summary: 'If anyone comes to the door between 9:00 PM and 6:30 AM, tell the whole family right away and offer live view.',
        params: { start: '21:00', end: '06:30' },
        actions: [{ type: 'notify', who: 'family' }, { type: 'live_view' }],
        severity: 'urgent',
      },
      enabled: true,
      createdAt: n - 21 * 24 * H,
      lastFiredAt: at(d(-2), '22:47'),
      fireCount: 2,
    },
    {
      id: 'rule-quiet',
      english: "If nobody comes or goes for 6 hours during the day, nudge me",
      compiled: {
        template: 'no_activity',
        summary: 'If there is no door activity for 6 hours between 8:00 AM and 8:00 PM, suggest Priya gives Asha a call.',
        params: { hours: 6, from: '08:00', to: '20:00' },
        actions: [{ type: 'notify', who: 'primary' }],
        severity: 'note',
      },
      enabled: true,
      createdAt: n - 14 * 24 * H,
      lastFiredAt: at(d(-1), '16:40'),
      fireCount: 1,
    },
    {
      id: 'rule-hivis',
      english: 'Tell me if someone in a high-visibility vest comes to the door',
      compiled: {
        template: 'custom_watch',
        summary: 'When someone is at the door, check if they are wearing a high-visibility vest, and if so tell Priya.',
        params: { question: 'Is anyone wearing a high-visibility vest?' },
        actions: [{ type: 'notify', who: 'primary' }],
        severity: 'note',
      },
      enabled: false,
      createdAt: n - 5 * 24 * H,
      fireCount: 0,
    },
  ]

  const rawEventsByDay = new Map<string, number>()
  ;[37, 29, 44, 33, 41, 26, 35].forEach((c, i) => rawEventsByDay.set(d(-i), c))

  return { household, schedules, devices, visits, moments, analyses, rules, rawEventsByDay }
}

export function funnelStats(days: number): FunnelStats {
  const k = days / 30
  return {
    windowDays: days,
    events: Math.round(1142 * k),
    stage1: Math.round(512 * k),
    stage2: Math.round(263 * k),
    stage3: Math.round(188 * k),
    moments: Math.round(141 * k),
    notified: Math.round(19 * k),
    costUsd: +(1.13 * k).toFixed(2),
    naiveCostUsd: +(6.97 * k).toFixed(2),
    stageMs: [1, 41, 24, 1260],
    visionCallUsd: 0.0061,
  }
}
