// Turns one Ring event into care meaning: run the CV funnel with the household's context, then decide
// whether it is a visit arrival/departure, a delivery, the parent going out, an after-dark visitor,
// a custom-rule match, or just noise (counted, never shown).
import type { Device, Moment } from '../../../shared/types.ts'
import { config } from '../config.ts'
import { getSetting, setSetting } from '../db.ts'
import { packageStillThere, runFunnel, type Verdict } from '../pipeline/funnel.ts'
import { SAME_VIEW, viewSimilarity } from '../pipeline/localVision.ts'
import { mediaFloor } from '../ring/auth.ts'
import { api, chime, mediaBytes, saveMedia } from '../ring/index.ts'
import { devices, events, household, moments, type RingEventRecord } from '../store.ts'
import { atLocal, clock, hhmmToMinutes, inWindow, localDate, localMinutes } from '../time.ts'
import { cancelJobs, onJob, schedule } from './jobs.ts'
import { createMoment, escalate, updateMoment } from './moments.ts'
import { activeRules, packageMinutes, quietHours, ruleFired } from './rules.ts'
import { inProgressVisits, markArrived, markDeparted, openVisits, type OpenVisit } from './visits.ts'

interface PackageState {
  momentId: string
  deviceId: string
  deliveredAt: number
  checks: number
  snapshotUrl?: string // the delivery frame, to make sure a re-check is looking at the same view
  remindedAt?: number
}

const PKG_KEY = 'package_outstanding'
const outstandingPackage = () => getSetting<PackageState | null>(PKG_KEY, null)
const setPackage = (p: PackageState | null) => setSetting(PKG_KEY, p)

export function fastDemo() {
  return process.env.DEMO_FAST === '1'
}

// Snapshot for an event: Ring image API "at_timestamp", falling back to "latest_in_range".
// The image endpoint only returns media that already exists; right after a motion event the recording may
// still be uploading and Ring answers 416 MEDIA_NOT_FOUND. So: at_timestamp (±10 s tolerance on Ring's side),
// then latest_in_range, with a short backoff between rounds.
async function frameFor(event: RingEventRecord, device: Device): Promise<{ jpeg: Buffer; url: string } | { error: string }> {
  if (device.encrypted) return { error: 'end-to-end encrypted device' }
  const ring = api()
  const at = frameTime(event)
  let lastError = ''
  // Events read back from history can be older than their media: wait a little longer for those.
  const waits = event.source === 'history' ? [0, 3_000, 6_000, 10_000, 20_000, 30_000] : [0, 3_000, 6_000, 10_000]
  for (const wait of waits) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    for (const req of [
      { type: 'at_timestamp' as const, timestamp: Math.min(at, Date.now()), width: 1280, height: 720 },
      { type: 'latest_in_range' as const, start: Math.max(event.at - 5_000, mediaFloor()), end: Math.min(event.endAt ?? event.at + 30_000, Date.now()), width: 1280, height: 720 },
    ]) {
      try {
        const shot = await ring.snapshot(event.deviceId, req)
        return { jpeg: shot.bytes, url: saveMedia(`ev_${safe(event.id)}`, shot.bytes) }
      } catch (err) {
        lastError = ringErrorText(err as Error)
        const status = (err as { status?: number }).status
        // 416 MEDIA_NOT_FOUND / 425 RECORDING_NOT_READY: the recording is still uploading, so wait and retry.
        // (latest_in_range over a span with no media has also answered 422 GRECO_NO_VALID_KEY.)
        if (status && ![404, 416, 422, 425].includes(status) && status < 500) return { error: lastError }
      }
    }
  }
  return { error: lastError || 'no media' }
}

const safe = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-60)

// "Ring media 416: {json}" → "416 MEDIA_NOT_FOUND: No media found in time range ..."
function ringErrorText(err: Error): string {
  const m = /^Ring media (\d+): (\{.*)$/s.exec(err.message)
  if (!m) return err.message.slice(0, 160)
  try {
    const e = JSON.parse(m[2]).errors?.[0]
    return `${m[1]} ${e?.code ?? ''}: ${e?.detail ?? ''}`.slice(0, 160)
  } catch {
    return err.message.slice(0, 160)
  }
}

// Which moment of the event to look at. A live trigger: a beat after it starts, when the subject is usually in
// frame. A finished event from history (start and end known): about a third of the way in, past the first
// seconds where a car or person is often still entering the scene.
function frameTime(event: RingEventRecord): number {
  const duration = event.endAt ? event.endAt - event.at : 0
  if (duration < 6_000) return event.at + 1500
  // Whole milliseconds: Ring rejects a fractional timestamp as an invalid request body (403).
  return Math.round(event.at + Math.min(Math.max(duration * 0.3, 1500), duration - 1000))
}

export async function processEvent(event: RingEventRecord) {
  const device = devices.get(event.deviceId)
  if (!device) return
  devices.put({ ...device, lastEventAt: event.at })
  if (event.kind === 'on_demand') return // live views (ours or the family's), not doorstep activity

  const quiet = quietHours()
  const ctx = {
    device,
    afterDark: inWindow(event.at, quiet.start, quiet.end),
    openVisits: openVisits(event.at),
    inProgress: inProgressVisits(event.at),
    packageOutstanding: Boolean(outstandingPackage()),
    watchVehicles: activeRules('unknown_vehicle').length > 0,
    customQuestions: activeRules('custom_watch').map((r) => ({ ruleId: r.id, question: String(r.compiled.params.question) })),
    frame: () => frameFor(event, device),
  }

  const { analysis, verdict } = await runFunnel(event, ctx)
  if (!verdict) return

  const base = { at: event.at, deviceId: device.id, deviceName: device.name, snapshotUrl: analysis.snapshotUrl, analysisId: analysis.id, eventIds: [event.id], confidence: verdict.confidence }
  const made: Moment[] = []
  const parent = household.get().parentName

  // 1. Custom plain-English watches answered by the vision model.
  for (const answer of verdict.custom ?? []) {
    const rule = activeRules('custom_watch').find((r) => r.id === answer.ruleId)
    if (!rule || !answer.answer) continue
    ruleFired(rule)
    made.push(createMoment({ ...base, kind: 'rule', severity: rule.compiled.severity, title: 'Your rule matched', body: `${rule.compiled.summary.replace(/\.$/, '')}: ${verdict.description}`, ruleId: rule.id, actions: ['watch_live', 'mark_handled'] }))
  }

  // 2. After dark: anyone at the door is worth a look; the parent leaving at night most of all.
  if (ctx.afterDark && (verdict.people ?? 1) > 0 && verdict.visitorType !== undefined) {
    const leaving = verdict.visitorType === 'resident' && verdict.activity === 'leaving'
    if (quiet.rule) ruleFired(quiet.rule)
    made.push(
      createMoment({
        ...base,
        kind: 'after_dark',
        severity: 'urgent',
        title: leaving ? `${parent} went out at ${clock(event.at)}` : `Someone at the door at ${clock(event.at)}`,
        body: leaving ? `${verdict.description} It's within quiet hours, so you may want to call ${parent}.` : `${verdict.description} No visit is expected at this hour.`,
        actions: ['watch_live', 'call_parent', 'mark_handled'],
      }),
    )
    await maybeChimeForRule(quiet.rule?.compiled.actions)
    return
  }

  // 3. Expected visits: arrival and departure.
  const visit = matchVisit(verdict, ctx.openVisits, event)
  if (visit && verdict.activity !== 'leaving' && verdict.activity !== 'passing') {
    const vehicleMatch = verdict.vehicle && verdict.scheduleId === visit.schedule.id
    markArrived(
      visit.visit,
      event.at,
      {
        kind: vehicleMatch ? 'vehicle_match' : event.kind === 'ding' ? 'ring_ding' : 'ring_motion',
        at: event.at,
        detail: vehicleMatch ? `${capitalize(visit.schedule.vehicleHint ?? 'car')} seen on ${device.name}` : `${verdict.description.replace(/\.$/, '')} (${device.name})`,
        snapshotUrl: analysis.snapshotUrl,
      },
      analysis.snapshotUrl,
      analysis.id,
      [event.id],
    )
    return
  }
  const leavingVisit = ctx.inProgress.find((v) => (verdict.activity === 'leaving' || verdict.activity === 'passing') && (verdict.scheduleId === v.schedule.id || verdict.visitorType === v.schedule.visitorType || (verdict.vehicle && v.schedule.vehicleHint)))
  if (leavingVisit && event.at - (leavingVisit.visit.arrivedAt ?? 0) > (fastDemo() ? 20_000 : 5 * 60_000)) {
    markDeparted(
      leavingVisit.visit,
      event.at,
      { kind: verdict.vehicle ? 'vehicle_match' : 'ring_motion', at: event.at, detail: `${verdict.description.replace(/\.$/, '')} (${device.name})`, snapshotUrl: analysis.snapshotUrl },
      analysis.snapshotUrl,
      analysis.id,
      [event.id],
    )
    return
  }

  // 4. Deliveries, with a later "is it still outside?" check.
  const pkg = outstandingPackage()
  // A delivery: a courier seen, Ring's package label, or a package on the step with nobody around.
  const delivered = verdict.visitorType === 'delivery' || event.subType === 'package_delivery' || (verdict.packagePresent === true && !verdict.people)
  if (delivered && verdict.packagePresent !== false && !pkg) {
    const checkInMs = packageCheckMs()
    const m = createMoment({
      ...base,
      kind: 'delivery',
      severity: 'note',
      title: 'Delivery left at the door',
      // The check is scheduled from now: an event read back from history can be a few minutes old.
      body: `${verdict.description} Homebeat will look again at ${clock(Math.max(event.at, Date.now()) + checkInMs)} and remind ${parent} if it's still outside.`,
      actions: ['watch_live'],
    })
    setPackage({ momentId: m.id, deviceId: device.id, deliveredAt: event.at, checks: 0, snapshotUrl: analysis.snapshotUrl })
    schedule('package_check', Date.now() + checkInMs, { deviceId: device.id })
    return
  }
  if (pkg && verdict.packagePresent && event.at - (pkg.remindedAt ?? pkg.deliveredAt) >= packageCheckMs()) {
    // A new event whose frame still shows the package, after the reminder time: that is the follow-up look.
    cancelJobs('package_check', () => true)
    await packageWaiting(pkg, device.id, analysis.snapshotUrl, verdict.confidence)
    return
  }
  if (pkg && (verdict.activity === 'collecting' || verdict.visitorType === 'resident')) {
    // Someone (probably the parent) is at the door while a package is out: re-check soon instead of waiting.
    cancelJobs('package_check', () => true)
    schedule('package_check', Date.now() + 20_000, { deviceId: pkg.deviceId })
  }

  // 5. The parent going out and coming back (daytime).
  if (verdict.visitorType === 'resident' && (verdict.activity === 'leaving' || verdict.activity === 'arriving')) {
    const out = verdict.activity === 'leaving'
    made.push(
      createMoment({
        ...base,
        kind: out ? 'resident_out' : 'resident_back',
        severity: 'calm',
        title: out ? `${parent} went out` : `${parent} is back home`,
        body: out ? `${verdict.description} Getting out is a good sign.` : verdict.description,
      }),
    )
    return
  }

  // 6. Vehicles nobody expects, if the family asked about them.
  if (verdict.vehicle && !verdict.people && ctx.watchVehicles) {
    const rule = activeRules('unknown_vehicle')[0]
    schedule('vehicle_check', Date.now() + (fastDemo() ? 60_000 : Number(rule.compiled.params.minutes) * 60_000), { deviceId: device.id, firstSeen: event.at, description: verdict.vehicle, ruleId: rule.id })
    return
  }

  // 7. Someone unexpected rang or waited at the door during the day.
  if (event.kind === 'ding' || (verdict.activity === 'waiting' && (verdict.visitorType === 'unknown' || verdict.visitorType === 'service'))) {
    made.push(
      createMoment({
        ...base,
        kind: 'visitor',
        severity: verdict.concern === 'high' ? 'heads_up' : 'note',
        title: event.kind === 'ding' ? 'Someone rang the bell' : 'Someone at the door',
        body: `${verdict.description} They're not on today's schedule.`,
        actions: ['watch_live', 'call_parent'],
      }),
    )
  }
  // Everything else (passers-by, the street, the wind) stays a counted raw event, never a notification.
}

function matchVisit(verdict: Verdict, open: OpenVisit[], event: RingEventRecord): OpenVisit | undefined {
  if (!open.length) return undefined
  // An arrival needs someone at the door, their car, or a doorbell press: a parcel on the step alone isn't a visit,
  // even if the vision model offers an expected_schedule_id for it.
  if (!verdict.people && !verdict.vehicle && event.kind !== 'ding') return undefined
  if (verdict.scheduleId && verdict.matchesExpected !== false) {
    const byId = open.find((o) => o.schedule.id === verdict.scheduleId)
    if (byId) return byId
  }
  const byType = open.filter((o) => o.schedule.visitorType === verdict.visitorType)
  if (byType.length) return byType.sort((a, b) => a.visit.expectedStart - b.visit.expectedStart)[0]
  // A doorbell press by someone the model can't place, inside exactly one open window, is most likely that visit.
  if (event.kind === 'ding' && open.length === 1 && verdict.visitorType !== 'delivery' && verdict.visitorType !== 'resident') return open[0]
  return undefined
}

async function maybeChimeForRule(actions?: { type: string; slot?: string }[]): Promise<boolean> {
  const action = actions?.find((a) => a.type === 'chime')
  if (!action) return false
  return playChime(action.slot ?? 'ring-appstore-event-1')
}

// Chime playback: resolve the audio_ref from the chime's configurations each time (never persist audio_ref).
export async function playChime(slotEvent = 'ring-appstore-event-1'): Promise<boolean> {
  const c = chime()
  if (!c) return false
  try {
    const bundles = await api().listDevices()
    const cfg = bundles.find((b) => b.device.id === c.id)?.configurations?.attributes as { audio?: { customizable_slots?: { event: string; audio_ref: string; disabled: boolean }[] } } | undefined
    const slot = cfg?.audio?.customizable_slots?.find((s) => s.event === slotEvent && !s.disabled)
    if (!slot) return false
    await api().playChime(c.id, slot.audio_ref)
    return true
  } catch (err) {
    console.warn('[chime] playback failed:', (err as Error).message)
    return false
  }
}

// ---- delayed checks ----

const packageCheckMs = () => (fastDemo() ? 60_000 : packageMinutes().minutes * 60_000)

onJob('package_check', async ({ deviceId, attempt = 0 }: { deviceId: string; attempt?: number }) => {
  const pkg = outstandingPackage()
  if (!pkg) return
  const shot = await api()
    .snapshot(deviceId, { type: 'latest_in_range', start: Math.max(Date.now() - 5 * 60_000, mediaFloor()), end: Date.now(), width: 1280, height: 720 })
    .catch(() => null)
  if (!shot) {
    // No recent media (a quiet camera records nothing; the Playground only has media while a clip plays).
    // Try again a few times; the next event at the door also counts as a fresh look (see processEvent).
    if (attempt < 5) schedule('package_check', Date.now() + (fastDemo() ? 20_000 : 10 * 60_000), { deviceId, attempt: attempt + 1 })
    return
  }
  // Only judge "still there / gone" from the same view as the delivery frame. A different scene (the camera
  // was moved or blocked, another component, or the Playground's single device playing another clip) proves
  // nothing, so it counts as no fresh look.
  const before = mediaBytes(pkg.snapshotUrl)
  if (before) {
    const similarity = await viewSimilarity(before, shot.bytes).catch(() => 1)
    if (similarity < SAME_VIEW) {
      if (attempt < 5) schedule('package_check', Date.now() + (fastDemo() ? 20_000 : 10 * 60_000), { deviceId, attempt: attempt + 1 })
      return
    }
  }
  const check = await packageStillThere(shot.bytes)
  const url = saveMedia(`pkg_${Date.now().toString(36)}`, shot.bytes)
  const minutesOut = Math.round((Date.now() - pkg.deliveredAt) / 60_000)
  if (!check.present) {
    setPackage(null)
    updateMoment(pkg.momentId, { severity: 'calm' })
    createMoment({ kind: 'delivery_collected', severity: 'calm', at: Date.now(), deviceId, snapshotUrl: url, title: 'Package brought inside', body: `The doorstep is clear again, ${minutesOut} min after the delivery.`, confidence: check.confidence })
    return
  }
  await packageWaiting(pkg, deviceId, url, check.confidence)
})

async function packageWaiting(pkg: PackageState, deviceId: string, snapshotUrl: string | undefined, confidence: number) {
  const parent = household.get().parentName
  const minutesOut = Math.max(1, Math.round((Date.now() - pkg.deliveredAt) / 60_000))
  const { rule } = packageMinutes()
  const chimed = await maybeChimeForRule(rule?.compiled.actions ?? [{ type: 'chime', slot: 'ring-appstore-event-1' }])
  if (rule) ruleFired(rule)
  createMoment({
    kind: 'delivery_waiting',
    severity: 'heads_up',
    at: Date.now(),
    deviceId,
    deviceName: devices.get(deviceId)?.name,
    snapshotUrl,
    title: `Package still outside after ${minutesOut} min`,
    body: chimed
      ? `Homebeat played a soft chime in ${parent}'s hallway as a reminder. If it's medicine or groceries, a quick call might help.`
      : `It's still on the doorstep. If it's medicine or groceries, a quick call to ${parent} might help.`,
    confidence,
    actions: ['play_chime', 'call_parent', 'watch_live'],
  })
  if (pkg.checks < 2) {
    setPackage({ ...pkg, checks: pkg.checks + 1, remindedAt: Date.now() })
    schedule('package_check', Date.now() + (fastDemo() ? 60_000 : 30 * 60_000), { deviceId })
  } else setPackage(null)
}

onJob('vehicle_check', async ({ deviceId, firstSeen, description, ruleId }: { deviceId: string; firstSeen: number; description: string; ruleId: string }) => {
  const shot = await api().snapshot(deviceId, { type: 'latest_in_range', start: Date.now() - 2 * 60_000, end: Date.now() }).catch(() => null)
  if (!shot) return
  const url = saveMedia(`veh_${Date.now().toString(36)}`, shot.bytes)
  const rule = activeRules('unknown_vehicle').find((r) => r.id === ruleId)
  if (rule) ruleFired(rule)
  createMoment({
    kind: 'vehicle',
    severity: 'heads_up',
    at: Date.now(),
    deviceId,
    snapshotUrl: url,
    ruleId,
    title: 'Unfamiliar vehicle still parked',
    body: `A ${description} has been there since ${clock(firstSeen)} and doesn't match anyone expected today.`,
    actions: ['watch_live'],
  })
})

onJob('escalate', ({ momentId, level }: { momentId: string; level: number }) => escalate(momentId, level))

// ---- quiet-day check (no_activity rule), run from the scheduler tick ----

export function checkQuiet(now = Date.now()) {
  const rule = activeRules('no_activity')[0]
  const hours = rule ? Number(rule.compiled.params.hours) : 6
  const from = rule ? String(rule.compiled.params.from ?? '08:00') : '08:00'
  const to = rule ? String(rule.compiled.params.to ?? '20:00') : '20:00'
  const mins = localMinutes(now)
  if (mins < hhmmToMinutes(from) || mins > hhmmToMinutes(to)) return
  const today = localDate(now)
  if (moments.all('WHERE kind = ? AND at > ?', 'quiet', now - 24 * 3600_000).some((m) => localDate(m.at) === today)) return
  const last = events.all('ORDER BY at DESC LIMIT 1')[0]
  // Count quiet time only from when Homebeat was watching, and only from the start of today's window.
  const since = Math.max(last?.at ?? 0, getSetting<number>('installed_at', now), atLocal(today, from))
  if (now - since < hours * 3600_000) return
  if (rule) ruleFired(rule)
  createMoment({
    kind: 'quiet',
    severity: 'note',
    at: now,
    title: 'A quiet day at the door',
    body: `No one has come or gone since ${clock(since)}. Might be a good moment to give ${household.get().parentName} a call.`,
    actions: ['call_parent'],
    ruleId: rule?.id,
  })
}

export const demoTiming = () => ({ fast: fastDemo(), pollMs: config.ring.pollMs })

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
