// Homebeat API contract, shared by server/ and web/.
// Every timestamp is epoch milliseconds (UTC). Times of day ("09:00") are in the household timezone.

export type Severity = 'calm' | 'note' | 'heads_up' | 'urgent'

export type VisitorType =
  | 'care_worker' // home aide, nurse, carer (uniform, lanyard, scrubs, care bag)
  | 'delivery' // courier, mail carrier, pharmacy / grocery driver
  | 'family'
  | 'service' // cleaner, gardener, tradesperson
  | 'unknown' // adult the app can't place
  | 'resident' // the parent themselves, coming or going

export type MomentKind =
  | 'visit_arrived'
  | 'visit_departed'
  | 'visit_late'
  | 'visit_missed'
  | 'delivery'
  | 'delivery_waiting' // a package is still outside after the rule's grace time
  | 'delivery_collected'
  | 'visitor' // unscheduled person at the door during the day
  | 'after_dark' // any door activity inside quiet hours
  | 'resident_out' // the parent left the house
  | 'resident_back'
  | 'quiet' // no door activity for longer than usual
  | 'vehicle' // vehicle arrived / parked
  | 'rule' // a custom plain-English rule matched
  | 'system' // device offline, token expired, encryption on, etc.

export interface Moment {
  id: string
  kind: MomentKind
  severity: Severity
  at: number
  title: string // "Maria's visit started"
  body: string // one calm sentence, never raw API language
  deviceId?: string
  deviceName?: string
  snapshotUrl?: string // served by our backend (/api/media/...), already watermarked by Ring
  visitId?: string
  ruleId?: string
  eventIds: string[] // Ring event ids that produced this moment
  analysisId?: string // link to the funnel trace
  confidence?: number // 0..1, shown as "looks like" when < 0.8
  ack?: { by: string; at: number } | null
  feedback?: 'right' | 'wrong' | null
  actions?: MomentAction[]
  sample?: boolean // true for seeded demo history (never for live Ring events)
}

export type MomentAction = 'watch_live' | 'play_chime' | 'call_parent' | 'mark_handled' | 'view_visit'

// ---- Visits (expected help: aides, nurses, meals) ----

export interface Schedule {
  id: string
  label: string // "Home aide"
  who: string // "Maria (BrightCare)"
  visitorType: VisitorType
  days: number[] // 0 = Sunday ... 6 = Saturday
  windowStart: string // "09:00"  earliest expected arrival
  windowEnd: string // "09:15"  latest on-time arrival
  graceMin: number // minutes after windowEnd before "late" turns into "missed"
  expectedMinutes: number // typical visit length
  vehicleHint?: string // "silver hatchback" (used by the Stage 2 vehicle matcher)
  checkinCode?: string // optional code on the aide's check-in link
  active: boolean
}

export type VisitStatus = 'upcoming' | 'due' | 'in_progress' | 'completed' | 'late' | 'missed'

export interface Visit {
  id: string
  scheduleId: string
  label: string
  who: string
  date: string // YYYY-MM-DD in household tz
  expectedStart: number
  expectedEnd: number
  status: VisitStatus
  arrivedAt?: number
  departedAt?: number
  minutes?: number // actual length
  lateByMin?: number
  evidence: VisitEvidence[]
  sample?: boolean
}

export interface VisitEvidence {
  kind: 'ring_motion' | 'ring_ding' | 'vehicle_match' | 'checkin_link' | 'vision'
  at: number
  detail: string // "Person at Front Door (Ring motion, human)"
  snapshotUrl?: string
}

// ---- Plain-English care rules ----

export type RuleTemplate =
  | 'expected_visit' // creates/updates a Schedule
  | 'package_waiting' // package outside longer than N minutes
  | 'quiet_hours' // any activity between start and end
  | 'no_activity' // no door activity for N hours during the day
  | 'unknown_vehicle' // vehicle not matching any known hint, parked > N min
  | 'custom_watch' // free-form visual question asked of the vision model

export interface CompiledRule {
  template: RuleTemplate
  summary: string // human restatement: "If a package sits outside for more than 30 min, nudge Asha with the chime and tell Priya."
  params: Record<string, string | number | boolean | number[]>
  // e.g. package_waiting: { minutes: 30 }
  //      quiet_hours: { start: '21:00', end: '06:00' }
  //      no_activity: { hours: 6, from: '08:00', to: '20:00' }
  //      custom_watch: { question: 'Is anyone wearing a high-visibility vest?' }
  actions: RuleAction[]
  severity: Severity
}

export type RuleAction =
  | { type: 'notify'; who: 'primary' | 'family' }
  | { type: 'chime'; slot: 'ring-appstore-event-1' | 'ring-appstore-event-2' }
  | { type: 'live_view' }
  | { type: 'escalate'; afterMin: number }

export interface Rule {
  id: string
  english: string
  compiled: CompiledRule
  enabled: boolean
  createdAt: number
  lastFiredAt?: number
  fireCount: number
}

// ---- Devices ----

export type DeviceKind = 'doorbell' | 'camera' | 'chime' | 'sensor' | 'unknown'

export interface Device {
  id: string
  name: string
  kind: DeviceKind
  online: boolean | null
  imageUrl?: string
  battery?: number | null // percentage when reported
  encrypted?: boolean // e2e_encryption.enabled -> media is unreadable, degrade gracefully
  privacyZones?: number
  motionZones?: number
  maxLiveSeconds?: number // 30 battery, 60 line powered
  chimeSlots?: { event: string; name: string; disabled: boolean }[]
  lastEventAt?: number
}

// ---- The CV funnel (Ring Computer Vision Guidelines: tiered funnel) ----

export type StageId = 0 | 1 | 2 | 3

export interface StageResult {
  stage: StageId
  name: string // "Ring sub_type filter", "Object gate", "Known-vehicle match", "Vision model"
  ran: boolean
  passed: boolean // whether the event advanced
  ms: number
  costUsd: number
  summary: string // "human -> process", "person 0.91, car 0.12", "no match", "care worker arriving with bag"
  detail?: Record<string, unknown>
}

export interface Analysis {
  id: string
  eventId: string
  deviceId: string
  startedAt: number
  stages: StageResult[]
  verdict: {
    visitorType?: VisitorType
    activity?: 'arriving' | 'leaving' | 'waiting' | 'passing' | 'delivering' | 'collecting' | 'unknown'
    packagePresent?: boolean
    vehicle?: string | null
    description: string
    confidence: number
  }
  snapshotUrl?: string
  totalMs: number
  totalCostUsd: number
}

export interface FunnelStats {
  windowDays: number
  events: number // raw Ring events received
  stage1: number // reached the object gate
  stage2: number
  stage3: number // reached the vision model
  moments: number // turned into something the family sees
  notified: number // pushed to a phone
  costUsd: number
  naiveCostUsd: number // what sending every event to the vision model would have cost
}

// ---- Household / home screen ----

export interface Member {
  id: string
  name: string
  relation: string // "Daughter"
  role: 'primary' | 'family' | 'viewer'
  escalationOrder: number
}

export interface Household {
  id: string
  parentName: string // "Asha"
  homeName: string // "Asha's home"
  timezone: string // "America/Los_Angeles"
  members: Member[]
  quietHours: { start: string; end: string }
  ringMode: 'playground' | 'linked' | 'offline_sim'
  ringAccountId?: string
  tokenExpiresAt?: number
}

export interface TodaySummary {
  household: Household
  status: { severity: Severity; headline: string; detail: string }
  nextVisit?: Visit
  visitsToday: Visit[]
  moments: Moment[] // newest first
  counts: { rawEvents: number; moments: number; notified: number }
  devices: Device[]
  lastSeenAt?: number // last time anyone/anything was seen at the door
}

export interface DailyDigest {
  date: string
  headline: string // "A calm Tuesday. Maria came on time and Asha went for her walk."
  bullets: string[]
  stats: { visitsCompleted: number; visitsExpected: number; deliveries: number; afterDark: number; outings: number }
  sample?: boolean
}

export interface WeeklyReport {
  weekOf: string
  visits: { scheduled: number; completed: number; onTime: number; late: number; missed: number; careMinutes: number }
  byDay: { date: string; visits: Visit[]; deliveries: number; afterDark: number; outings: number }[]
  highlights: string[]
  sample?: boolean
}

// ---- Live view (WHEP) ----

export interface LiveSessionResponse {
  sdpAnswer: string
  sessionId: string // opaque id our backend maps to Ring's Location URL
  maxSeconds: number
}

// ---- Server-sent events on /api/stream ----

export type StreamMessage =
  | { type: 'moment'; moment: Moment }
  | { type: 'moment_updated'; moment: Moment }
  | { type: 'visit'; visit: Visit }
  | { type: 'event'; eventId: string; deviceId: string; subType: string; at: number }
  | { type: 'stage'; eventId: string; stage: StageResult }
  | { type: 'analysis'; analysis: Analysis }
  | { type: 'device'; device: Device }
  | { type: 'status'; status: TodaySummary['status'] }
  | { type: 'ring'; mode: Household['ringMode']; tokenExpiresAt?: number; error?: string }
