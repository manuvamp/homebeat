// Where Ring events enter Homebeat:
//  - webhooks (linked apps): verified + acknowledged in the route, then handed here
//  - Event History polling (Ring Developer Playground, which has no webhook URL) and the offline simulator
// Every event is stored once (idempotent on its id) and processed by a small serial queue, so the
// webhook handler can answer Ring in well under the 5-second limit.
import { publish } from './bus.ts'
import { config } from './config.ts'
import { getSetting, setSetting } from './db.ts'
import { processEvent } from './care/engine.ts'
import { RingAuthError } from './ring/auth.ts'
import { api, cameras, ringMode } from './ring/index.ts'
import { events, household, type RingEventRecord } from './store.ts'

const queue: RingEventRecord[] = []
let working = false

export function ingest(e: RingEventRecord): boolean {
  if (events.get(e.id)) return false
  events.put(e)
  publish({ type: 'event', eventId: e.id, deviceId: e.deviceId, subType: e.subType, at: e.at })
  queue.push(e)
  void drain()
  return true
}

async function drain() {
  if (working) return
  working = true
  try {
    while (queue.length) {
      const next = queue.shift()!
      try {
        await processEvent(next)
      } catch (err) {
        console.error('[ingest] processing failed for', next.id, (err as Error).message)
      }
    }
  } finally {
    working = false
  }
}

export const queueDepth = () => queue.length + (working ? 1 : 0)

// Map Ring history event_type to our kinds.
const kindOf = (t: string): RingEventRecord['kind'] => (t === 'motion' || t === 'ding' || t === 'on_demand' ? t : 'other')

// The history response carries event_type but not the motion sub-type; the composite filter syntax
// (event_types=motion.human, ...) does. So when new events appear we ask once per sub-type.
const SUBTYPE_FILTERS = ['human', 'vehicle', 'package_delivery', 'animal', 'other_motion']

let polling = false
let lastError = ''

export async function pollHistory() {
  if (polling) return
  polling = true
  const mode = ringMode()
  try {
    // Remember what was already in history when we connected, so a fresh connection doesn't replay old events.
    const baseline = getSetting<Record<string, number>>('history_baseline', {})
    for (const device of cameras()) {
      const list = await api().getHistory(device.id)
      if (!(device.id in baseline)) {
        // First time we see this device: only events from now on (minus a little slack) are new.
        baseline[device.id] = Date.now() - 60_000
        setSetting('history_baseline', baseline)
      }
      const fresh = list.filter((e) => !events.get(e.id) && e.start >= baseline[device.id])
      if (!fresh.length) continue
      const subtypes = new Map<string, string>()
      if (mode !== 'offline_sim' && fresh.some((e) => e.eventType === 'motion' && !e.subType)) {
        for (const sub of SUBTYPE_FILTERS) {
          try {
            for (const e of await api().getHistory(device.id, [`motion.${sub}`])) subtypes.set(e.id, sub)
          } catch {
            /* a filter the API doesn't accept: skip it */
          }
        }
      }
      for (const e of fresh.sort((a, b) => a.start - b.start)) {
        ingest({
          id: e.id,
          deviceId: device.id,
          at: e.start,
          endAt: e.end,
          kind: kindOf(e.eventType),
          subType: e.subType ?? subtypes.get(e.id) ?? (e.eventType === 'motion' ? 'motion' : e.eventType),
          source: mode === 'offline_sim' ? 'sim' : 'history',
        })
      }
    }
    if (lastError) publish({ type: 'ring', mode, tokenExpiresAt: household.get().tokenExpiresAt })
    lastError = ''
  } catch (err) {
    const message = err instanceof RingAuthError ? 'Ring token expired: paste a fresh one from the Ring Developer Playground' : (err as Error).message
    if (message !== lastError) {
      console.warn('[poll]', message)
      publish({ type: 'ring', mode, error: message })
    }
    lastError = message
  } finally {
    polling = false
  }
}

export function ringError() {
  return lastError
}

export const pollEveryMs = () => config.ring.pollMs
