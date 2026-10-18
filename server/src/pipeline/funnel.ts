// The tiered CV funnel from Ring's "Computer Vision Guidelines for Ring Appstore Apps":
// spend compute in proportion to the probability that an event matters.
//   Stage 0  Ring's own sub_type on the event (free, before any download)
//   Stage 1  local object gate on one frame (CPU, free)
//   Stage 2  local zero-shot attire / vehicle match (CPU, free)
//   Stage 3  vision model (paid), only for ambiguous or high-stakes events
import type { Analysis, Device, Schedule, StageResult, Visit, VisitorType } from '../../../shared/types.ts'
import { askJson, aiEnabled } from '../ai/provider.ts'
import { publish } from '../bus.ts'
import { config } from '../config.ts'
import { uid } from '../db.ts'
import { analyses, events, household, type RingEventRecord } from '../store.ts'
import { ANIMAL, CARRIED, detectObjects, PERSON, VEHICLE, zeroShot, type Detection } from './localVision.ts'

export interface FunnelContext {
  device: Device
  afterDark: boolean
  openVisits: { visit: Visit; schedule: Schedule }[] // expected visits whose window is open now
  inProgress: { visit: Visit; schedule: Schedule }[]
  packageOutstanding: boolean
  watchVehicles: boolean // an unknown_vehicle rule exists
  customQuestions: { ruleId: string; question: string }[]
  frame: () => Promise<{ jpeg: Buffer; url: string } | { error: string }>
}

export interface Verdict {
  visitorType?: VisitorType
  activity?: Analysis['verdict']['activity']
  packagePresent?: boolean
  vehicle?: string | null
  people?: number
  concern?: 'none' | 'low' | 'high'
  matchesExpected?: boolean | null
  scheduleId?: string
  custom?: { ruleId: string; answer: boolean }[]
  description: string
  confidence: number
}

export interface FunnelOutcome {
  analysis: Analysis
  verdict: Verdict | null // null: stopped early, nothing worth a moment
}

// Subtypes Homebeat can drop at the webhook. Everything else (including values we have never seen) is processed.
const SKIP_SUBTYPES = new Set(['animal'])
const DEBOUNCE_MS = 25_000

const PERSON_LABELS: { label: string; type: VisitorType; activity?: Verdict['activity'] }[] = [
  { label: 'a home care worker or nurse wearing scrubs or a uniform, carrying a bag', type: 'care_worker' },
  { label: 'a delivery driver carrying a cardboard package', type: 'delivery', activity: 'delivering' },
  { label: 'an older adult at their own front door', type: 'resident' },
  { label: 'a worker in a high-visibility vest or work clothes', type: 'service' },
  { label: 'a person in everyday clothes', type: 'unknown' },
]

const PACKAGE_LABEL = 'a cardboard package left on the doorstep'
const ANIMAL_LABEL = 'birds or an animal, with no people'

function stage(stage: StageResult['stage'], name: string, partial: Partial<StageResult>): StageResult {
  return { stage, name, ran: false, passed: false, ms: 0, costUsd: 0, summary: '', ...partial }
}

export async function runFunnel(event: RingEventRecord, ctx: FunnelContext): Promise<FunnelOutcome> {
  const startedAt = Date.now()
  const analysis: Analysis = {
    id: uid('an'),
    eventId: event.id,
    deviceId: event.deviceId,
    startedAt,
    stages: [],
    verdict: { description: '', confidence: 0 },
    totalMs: 0,
    totalCostUsd: 0,
  }
  const push = (s: StageResult) => {
    analysis.stages.push(s)
    publish({ type: 'stage', eventId: event.id, stage: s })
  }
  const finish = (verdict: Verdict | null): FunnelOutcome => {
    for (const n of [0, 1, 2, 3] as const) {
      if (!analysis.stages.find((s) => s.stage === n)) push(stage(n, STAGE_NAMES[n], { summary: 'not needed' }))
    }
    analysis.stages.sort((a, b) => a.stage - b.stage)
    analysis.totalMs = Date.now() - startedAt
    analysis.totalCostUsd = analysis.stages.reduce((sum, s) => sum + s.costUsd, 0)
    if (verdict) {
      analysis.verdict = {
        visitorType: verdict.visitorType,
        activity: verdict.activity,
        packagePresent: verdict.packagePresent,
        vehicle: verdict.vehicle ?? null,
        description: verdict.description,
        confidence: verdict.confidence,
      }
    } else {
      analysis.verdict = { description: analysis.stages.at(-1)?.summary ?? 'Filtered', confidence: 1 }
    }
    analyses.put(analysis)
    publish({ type: 'analysis', analysis })
    return { analysis, verdict }
  }

  // ---------- Stage 0: Ring sub_type (free) ----------
  let t = Date.now()
  const sub = event.subType || 'unknown'
  const recent = events
    .all('WHERE device_id = ? AND at < ? AND at > ? AND id != ?', event.deviceId, event.at + 1, event.at - DEBOUNCE_MS, event.id)
    .filter((e) => e.subType === sub && e.kind === event.kind)
  let s0: { pass: boolean; why: string }
  if (event.kind === 'ding') s0 = { pass: true, why: 'doorbell pressed → always process' }
  else if (SKIP_SUBTYPES.has(sub)) s0 = { pass: false, why: `${sub} → skipped (not a care event)` }
  else if (recent.length) s0 = { pass: false, why: `${sub} burst → merged with event ${Math.round((event.at - recent[0].at) / 1000)} s earlier` }
  else if (sub === 'vehicle' && !ctx.afterDark && !ctx.watchVehicles && !ctx.openVisits.some((v) => v.schedule.vehicleHint) && !ctx.inProgress.length)
    s0 = { pass: false, why: 'vehicle, no visit expected → passing traffic' }
  else if (event.origin === 'playground_live') s0 = { pass: true, why: 'Playground event, no Ring sub_type → look at the frame' }
  else if (sub === 'unknown') s0 = { pass: true, why: 'no Ring sub_type → look at the frame' }
  else s0 = { pass: true, why: `${sub} → process` }
  push(stage(0, STAGE_NAMES[0], { ran: true, passed: s0.pass, ms: Date.now() - t, summary: s0.why, detail: { subType: sub, kind: event.kind } }))
  if (!s0.pass) return finish(null)

  // A frame for the later stages: Ring image snapshot at the event time.
  const frame = await ctx.frame()
  if ('error' in frame) {
    // Encrypted (TAKE) devices or missing media: degrade to Ring's own classification, never retry-loop.
    push(stage(1, STAGE_NAMES[1], { summary: `no frame: ${frame.error}` }))
    return finish(metadataVerdict(event, ctx))
  }
  analysis.snapshotUrl = frame.url

  // ---------- Stage 1: object gate (CPU) ----------
  let dets: Detection[] = []
  t = Date.now()
  if (config.cv.stage1) {
    try {
      dets = await detectObjects(frame.jpeg)
    } catch (err) {
      push(stage(1, STAGE_NAMES[1], { ran: false, passed: true, summary: `object gate unavailable (${(err as Error).message.slice(0, 60)}) → pass` }))
    }
  }
  const people = dets.filter((d) => PERSON.has(d.label))
  const vehicles = dets.filter((d) => VEHICLE.has(d.label))
  const animals = dets.filter((d) => ANIMAL.has(d.label))
  const carried = dets.filter((d) => CARRIED.has(d.label))
  if (config.cv.stage1 && !analysis.stages.find((s) => s.stage === 1)) {
    // Packages aren't a class the on-device detector knows. When Ring gave no label at all, "nothing detected"
    // can't rule a delivery out, so the frame goes on to the zero-shot stage; an animal alone still stops here.
    const unlabelled = sub === 'unknown' && !animals.length
    const relevant = people.length > 0 || vehicles.length > 0 || sub === 'package_delivery' || event.kind === 'ding' || unlabelled
    const top = dets.slice(0, 4).map((d) => `${d.label} ${d.score.toFixed(2)}`).join(', ') || 'nothing detected'
    push(
      stage(1, STAGE_NAMES[1], {
        ran: true,
        passed: relevant,
        ms: Date.now() - t,
        summary: relevant
          ? people.length || vehicles.length || dets.length ? top : `${top}, no Ring label → check the scene`
          : animals.length ? `only ${animals[0].label} → stop` : `${top} → stop`,
        detail: { detections: dets.slice(0, 8) },
      }),
    )
    if (!relevant) return finish(null)
  }

  // ---------- Stage 2: zero-shot attire / vehicle match (CPU) ----------
  let resolved: Verdict | null = null
  t = Date.now()
  if (config.cv.stage2) {
    try {
      const vehicleHints = [...ctx.openVisits, ...ctx.inProgress].filter((v) => v.schedule.vehicleHint)
      const labels = [
        ...(people.length || !vehicles.length ? PERSON_LABELS.map((p) => p.label) : []),
        ...(!people.length && !vehicles.length ? [PACKAGE_LABEL, ANIMAL_LABEL] : []),
        ...vehicleHints.map((v) => `a ${v.schedule.vehicleHint} pulling in or parked`),
        ...(vehicles.length ? ['a delivery van', 'an unfamiliar car on the street'] : []),
        'an empty doorstep with no one there',
      ]
      const scores = await zeroShot(frame.jpeg, labels)
      const best = scores[0]
      const personHit = PERSON_LABELS.find((p) => p.label === best.label)
      const hintHit = vehicleHints.find((v) => best.label.startsWith(`a ${v.schedule.vehicleHint}`))
      const packageHit = best.label === PACKAGE_LABEL
      // Birds and pets the detector missed: stop here too, still without a paid call.
      const animalOnly = best.label === ANIMAL_LABEL && best.score >= 0.5
      // Resolve here only when it is clear-cut AND low stakes; after-dark and custom questions always go to Stage 3.
      const highStakes = ctx.afterDark || ctx.customQuestions.length > 0
      // Who it is isn't enough: arrival vs departure needs direction, from a second cheap zero-shot pass.
      let direction: { activity: Verdict['activity']; score: number } | null = null
      if (best.score >= 0.6 && !highStakes && personHit && personHit.type !== 'unknown' && !personHit.activity) {
        const dir = await zeroShot(frame.jpeg, DIRECTION_LABELS.map((d) => d.label))
        const top = DIRECTION_LABELS.find((d) => d.label === dir[0].label)!
        direction = { activity: top.activity, score: dir[0].score }
      }
      if (best.score >= 0.6 && !highStakes) {
        if (personHit && personHit.type !== 'unknown' && (personHit.activity || (direction && direction.score >= 0.55))) {
          resolved = {
            visitorType: personHit.type,
            activity: personHit.activity ?? direction!.activity,
            packagePresent: personHit.type === 'delivery' || sub === 'package_delivery' ? true : undefined,
            people: people.length || 1,
            description: describeFromLabel(personHit.type, carried, personHit.activity ?? direction!.activity),
            confidence: Math.min(best.score, direction?.score ?? 1),
          }
        } else if (packageHit) {
          resolved = {
            visitorType: 'delivery',
            activity: 'delivering',
            packagePresent: true,
            people: 0,
            description: 'A package left on the doorstep.',
            confidence: best.score,
          }
        } else if (hintHit) {
          resolved = {
            visitorType: hintHit.schedule.visitorType,
            activity: ctx.inProgress.find((v) => v.schedule.id === hintHit.schedule.id) ? 'leaving' : 'arriving',
            vehicle: hintHit.schedule.vehicleHint,
            scheduleId: hintHit.schedule.id,
            matchesExpected: true,
            description: `A ${hintHit.schedule.vehicleHint} in the driveway, matching ${hintHit.schedule.who}'s car.`,
            confidence: best.score,
          }
        }
      }
      push(
        stage(2, STAGE_NAMES[2], {
          ran: true,
          passed: !resolved && !animalOnly,
          ms: Date.now() - t,
          summary: `${shortLabel(best.label)} ${best.score.toFixed(2)}${animalOnly ? ' → not a care event, stop' : resolved ? ' → resolved, no vision model needed' : highStakes ? ' → high stakes, verify' : ' → unsure, escalate'}`,
          detail: { scores: scores.slice(0, 5) },
        }),
      )
    } catch (err) {
      push(stage(2, STAGE_NAMES[2], { ran: false, passed: true, summary: `zero-shot unavailable → escalate` }))
    }
  }
  if (resolved) return finish(resolved)
  if (analysis.stages.find((s) => s.stage === 2 && s.ran && !s.passed)) return finish(null)

  // ---------- Stage 3: vision model (paid) ----------
  if (!aiEnabled()) {
    push(stage(3, STAGE_NAMES[3], { summary: 'vision model off → using Ring sub_type' }))
    return finish(metadataVerdict(event, ctx, people.length, vehicles.length))
  }
  t = Date.now()
  try {
    const v = await askVisionModel(event, ctx, frame.jpeg, dets)
    push(
      stage(3, STAGE_NAMES[3], {
        ran: true,
        passed: true,
        ms: Date.now() - t,
        costUsd: config.ai.visionCallUsd,
        summary: v.description,
        detail: { model: config.ai.provider === 'bedrock' ? config.ai.bedrockModel : config.ai.visionModel, verdict: v },
      }),
    )
    return finish(v)
  } catch (err) {
    console.warn('[funnel] vision model failed:', (err as Error).message)
    push(stage(3, STAGE_NAMES[3], { ran: true, passed: false, ms: Date.now() - t, summary: `vision model error → Ring sub_type fallback`, detail: { error: (err as Error).message.slice(0, 200) } }))
    return finish(metadataVerdict(event, ctx, people.length, vehicles.length))
  }
}

export const STAGE_NAMES = ['Ring sub_type filter', 'Object gate (on-device)', 'Attire & vehicle match (on-device)', 'Vision model'] as const

function shortLabel(label: string) {
  return label.replace(/^an? /, '').split(',')[0]
}

const DIRECTION_LABELS: { label: string; activity: Verdict['activity'] }[] = [
  { label: 'a person walking toward the camera and the front door', activity: 'arriving' },
  { label: 'a person walking away from the house, seen from behind', activity: 'leaving' },
  { label: 'a person standing still at the front door, waiting', activity: 'waiting' },
]

function describeFromLabel(type: VisitorType, carried: Detection[], activity?: Verdict['activity']): string {
  const bag = carried.length ? ` with a ${carried[0].label}` : ''
  const where = activity === 'leaving' ? 'leaving' : activity === 'waiting' ? 'waiting at the door' : 'coming to the door'
  switch (type) {
    case 'care_worker':
      return `Someone in a care uniform${bag}, ${where}.`
    case 'delivery':
      return 'A delivery driver with a package.'
    case 'resident':
      return activity === 'leaving' ? `${household.get().parentName} heading out.` : `${household.get().parentName} at the front door.`
    case 'service':
      return `A worker in work clothes${bag}, ${where}.`
    default:
      return 'A person at the door.'
  }
}

// When there is no readable frame (encrypted device, vision off): use Ring's own classification only.
function metadataVerdict(event: RingEventRecord, ctx: FunnelContext, people = 0, vehicles = 0): Verdict {
  const sub = event.subType
  if (sub === 'package_delivery') return { visitorType: 'delivery', activity: 'delivering', packagePresent: true, description: 'Ring detected a package delivery.', confidence: 0.7 }
  if (sub === 'vehicle' || (vehicles && !people)) return { vehicle: 'vehicle', activity: 'arriving', description: 'Ring detected a vehicle.', confidence: 0.6 }
  // No label from Ring and no frame to look at: nothing to say, so no moment.
  if (sub === 'unknown' && !people) return { activity: 'unknown', people: 0, description: 'Activity with no Ring label and no frame to check.', confidence: 0.3 }
  if (event.kind === 'ding') return { visitorType: 'unknown', activity: 'waiting', people: 1, description: 'Someone rang the doorbell.', confidence: 0.7 }
  return { visitorType: 'unknown', activity: 'unknown', people: people || 1, description: 'Ring detected a person at the door.', confidence: 0.5 }
}

interface ModelVerdict {
  people: number
  visitor_type: VisitorType | 'none'
  activity: Verdict['activity']
  package_present: boolean
  vehicle: string | null
  matches_expected_visit: boolean | null
  expected_schedule_id?: string | null
  concern: 'none' | 'low' | 'high'
  description: string
  custom?: { rule_id: string; answer: boolean }[]
  confidence: number
}

async function askVisionModel(event: RingEventRecord, ctx: FunnelContext, jpeg: Buffer, dets: Detection[]): Promise<Verdict> {
  const expected = ctx.openVisits.map((v) => `- id ${v.schedule.id}: ${v.schedule.label} (${v.schedule.who}), type ${v.schedule.visitorType}${v.schedule.vehicleHint ? `, usually drives a ${v.schedule.vehicleHint}` : ''}`)
  const inside = ctx.inProgress.map((v) => `- id ${v.schedule.id}: ${v.schedule.label} (${v.schedule.who}) arrived and has not left yet`)
  const prompt = [
    `Camera: "${ctx.device.name}" (${ctx.device.kind}). Ring event: ${event.kind}${event.subType ? `, Ring sub_type "${event.subType}"` : ''}.`,
    `Time context: ${ctx.afterDark ? 'quiet hours (after dark)' : 'daytime'}.`,
    expected.length ? `Expected visits right now:\n${expected.join('\n')}` : 'No visit is expected right now.',
    inside.length ? `Currently inside:\n${inside.join('\n')}` : '',
    ctx.packageOutstanding ? 'A package was delivered earlier and may still be on the doorstep.' : '',
    dets.length ? `An on-device detector saw: ${dets.slice(0, 6).map((d) => `${d.label} ${d.score.toFixed(2)}`).join(', ')}.` : '',
    ctx.customQuestions.length ? `Also answer these yes/no questions about the frame:\n${ctx.customQuestions.map((q) => `- rule_id ${q.ruleId}: ${q.question}`).join('\n')}` : '',
    `Return ONLY a JSON object with keys: people (int), visitor_type ("care_worker"|"delivery"|"family"|"service"|"unknown"|"resident"|"none"), activity ("arriving"|"leaving"|"waiting"|"passing"|"delivering"|"collecting"|"unknown"), package_present (bool), vehicle (short description or null), matches_expected_visit (true/false/null; true only if a person or their vehicle fitting that visit is visible), expected_schedule_id (id or null), concern ("none"|"low"|"high"), description (one short neutral sentence, max 18 words), custom (array of {rule_id, answer}), confidence (0-1).`,
  ]
    .filter(Boolean)
    .join('\n')
  const v = await askJson<ModelVerdict>({
    system:
      "You look at one frame from an older person's Ring doorbell or camera for Homebeat, a family care app. Describe only what is visible: clothing, uniforms, bags, packages, vehicles, what people are doing. Never identify anyone by their face or guess names or ethnicity. 'resident' means an older adult who appears to live there, coming or going. The Ring logo, device id, app name and timestamp watermarks in the corners are not part of the scene. Be calm and factual.",
    prompt,
    images: [{ bytes: jpeg, mediaType: 'image/jpeg' }],
    maxTokens: 350,
  })
  return {
    visitorType: v.visitor_type === 'none' ? undefined : v.visitor_type,
    activity: v.activity,
    packagePresent: v.package_present,
    vehicle: v.vehicle,
    people: v.people,
    concern: v.concern,
    matchesExpected: v.matches_expected_visit,
    scheduleId: v.expected_schedule_id ?? undefined,
    custom: v.custom?.map((c) => ({ ruleId: c.rule_id, answer: c.answer })),
    description: v.description,
    confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0.7)),
  }
}

// Cheap re-check used by "is the package still outside?" watchers: CLIP first, vision model only if unsure.
export async function packageStillThere(jpeg: Buffer): Promise<{ present: boolean; confidence: number; stage: 2 | 3; summary: string }> {
  try {
    const scores = await zeroShot(jpeg, ['a cardboard package or parcel left on a doorstep', 'an empty doorstep with no package'])
    const present = scores.find((s) => s.label.startsWith('a cardboard'))!.score
    if (present > 0.75 || present < 0.25) return { present: present > 0.5, confidence: Math.max(present, 1 - present), stage: 2, summary: `package ${present.toFixed(2)}` }
  } catch {
    /* fall through to the vision model */
  }
  if (!aiEnabled()) return { present: true, confidence: 0.5, stage: 2, summary: 'unsure, assuming still there' }
  const v = await askJson<{ package_present: boolean; confidence: number; description: string }>({
    system: 'You check a Ring doorstep frame for a family care app. Ignore watermarks in the corners.',
    prompt: 'Is there a package, parcel, bag or box left on the doorstep or porch? Reply only JSON {"package_present": bool, "confidence": 0-1, "description": "max 12 words"}.',
    images: [{ bytes: jpeg, mediaType: 'image/jpeg' }],
    maxTokens: 120,
  })
  return { present: v.package_present, confidence: v.confidence, stage: 3, summary: v.description }
}
