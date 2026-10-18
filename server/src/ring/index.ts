// Picks the Ring backend: the real Partner API whenever a Playground token or linked account exists,
// the offline simulator otherwise. Also turns JSON:API device bundles into Homebeat's Device shape.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Device, DeviceKind, Household } from '../../../shared/types.ts'
import { publish } from '../bus.ts'
import { config } from '../config.ts'
import { getSetting, setSetting } from '../db.ts'
import { devices, household } from '../store.ts'
import { tokenState } from './auth.ts'
import { ringApi, type DeviceBundle, type RingApi } from './client.ts'
import { simApi } from './sim.ts'

export function ringMode(): Household['ringMode'] {
  if (config.ring.forceSim) return 'offline_sim'
  const state = tokenState()
  if (state.mode === 'playground') return 'playground'
  if (state.mode === 'linked') return 'linked'
  return 'offline_sim'
}

export function api(): RingApi {
  return ringMode() === 'offline_sim' ? simApi : ringApi
}

type Attrs = Record<string, any> // JSON:API attributes are loosely typed; read defensively

export function normalizeDevice(b: DeviceBundle): Device {
  const status: Attrs = b.status?.attributes ?? {}
  const caps: Attrs = b.capabilities?.attributes ?? {}
  const cfg: Attrs = b.configurations?.attributes ?? {}
  const name = b.device.attributes?.name ?? 'Ring device'

  // The device resource has no type field (docs: identify chimes by audio.customizable_slots > 0, and don't
  // parse image_url). Doorbell vs camera comes from the name the family gave it.
  let kind: DeviceKind = 'unknown'
  if ((caps.audio?.customizable_slots ?? 0) > 0) kind = 'chime'
  else if (caps.video && caps.video.codecs !== null) kind = /door|bell|front/i.test(name) ? 'doorbell' : 'camera'
  else if (status.battery_status || caps.contact || caps.temperature) kind = 'sensor'
  else if (caps.video === undefined) kind = /door|bell/i.test(name) ? 'doorbell' : 'camera'

  const battery = typeof status.battery_status?.percentage === 'number' ? status.battery_status.percentage : null
  const slots = Array.isArray(cfg.audio?.customizable_slots)
    ? [...cfg.audio.customizable_slots]
        .sort((a: Attrs, c: Attrs) => String(a.event).localeCompare(String(c.event)))
        .map((s: Attrs) => ({ event: String(s.event), name: String(s.audio_name ?? s.event), disabled: Boolean(s.disabled) }))
    : undefined
  return {
    id: b.device.id,
    name,
    kind,
    online: typeof status.online === 'boolean' ? status.online : null,
    imageUrl: b.device.attributes?.image_url,
    battery: battery !== null && battery >= 0 && battery <= 100 ? battery : null,
    // Docs: e2e_encryption.enabled is a JSON boolean, unlike the "on"/"off" strings elsewhere.
    encrypted: cfg.e2e_encryption?.enabled === true,
    // Privacy zones live under image_enhancements in the live API (older docs show them elsewhere).
    privacyZones: [cfg.image_enhancements?.privacy_zones, cfg.privacy_zones, cfg.motion_detection?.privacy_zones].find(Array.isArray)?.length,
    motionZones: Array.isArray(cfg.motion_detection?.motion_zones) ? cfg.motion_detection.motion_zones.length : undefined,
    // Live view limits: 30 s on battery devices, 60 s on line-powered ones.
    maxLiveSeconds: kind === 'chime' ? undefined : battery !== null || status.power_source === 'battery' ? 30 : 60,
    chimeSlots: slots,
    lastEventAt: devices.get(b.device.id)?.lastEventAt,
  }
}

export async function refreshDevices(): Promise<Device[]> {
  const bundles = await api().listDevices()
  const list = bundles.map(normalizeDevice)
  const ids = new Set(list.map((d) => d.id))
  for (const old of devices.all()) if (!ids.has(old.id)) devices.remove(old.id)
  for (const d of list) {
    devices.put(d)
    publish({ type: 'device', device: d })
  }
  household.patch({ ringMode: ringMode(), tokenExpiresAt: tokenState().expiresAt })
  return list
}

export const cameras = () => devices.all().filter((d) => d.kind === 'doorbell' || d.kind === 'camera' || d.kind === 'unknown')
export const chime = () => devices.all().find((d) => d.kind === 'chime' && d.online !== false)

// Snapshots we keep: only frames that became moments or analyses (retention job prunes after 30 days).
export function saveMedia(id: string, bytes: Buffer): string {
  writeFileSync(join(config.dataDir, 'media', `${id}.jpg`), bytes)
  return `/api/media/${id}.jpg`
}

export function mediaBytes(url?: string): Buffer | undefined {
  const file = url?.match(/^\/api\/media\/([\w-]+\.jpg)$/)?.[1]
  const path = file ? join(config.dataDir, 'media', file) : ''
  return path && existsSync(path) ? readFileSync(path) : undefined
}

// Live views Homebeat itself opened. Ring records every live view as an `on_demand` history event; ours must
// not be mistaken for doorstep activity, while the Playground's simulated live-view events should be analysed.
interface OwnLive {
  deviceId: string
  start: number
  end?: number
}
const OWN_LIVE = 'own_live_sessions'

export function noteOwnLive(deviceId: string, start: number, end?: number) {
  const list = getSetting<OwnLive[]>(OWN_LIVE, []).filter((s) => !(s.deviceId === deviceId && s.start === start))
  setSetting(OWN_LIVE, [...list, { deviceId, start, end }].slice(-50))
}

export function isOwnLive(deviceId: string, at: number): boolean {
  const slack = 5_000
  return getSetting<OwnLive[]>(OWN_LIVE, []).some((s) => s.deviceId === deviceId && at >= s.start - slack && at <= (s.end ?? s.start + 120_000) + slack)
}
