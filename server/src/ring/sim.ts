// Offline simulator: implements the same RingApi interface with three virtual devices and doorstep
// scenes, so anyone can run Homebeat without a Ring account. Always labelled "Offline simulator" in the UI.
// The real integration (ringApi) is used whenever a Ring Playground token or linked account is present.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../config.ts'
import type { DeviceBundle, HistoryEvent, MediaResult, RingApi } from './client.ts'
import { RingApiError } from './client.ts'

export const SIM_DEVICES = {
  door: 'sim.ring.device.front-door',
  driveway: 'sim.ring.device.driveway',
  chime: 'sim.ring.device.hallway-chime',
}

export type SimScene = 'empty' | 'aide_arrive' | 'aide_leave' | 'courier' | 'package' | 'meals' | 'resident' | 'night' | 'car' | 'driveway_empty'

export type SimAction =
  | 'aide_arrives'
  | 'aide_leaves'
  | 'delivery'
  | 'package_collected'
  | 'meals'
  | 'resident_out'
  | 'night_visitor'
  | 'car_arrives'
  | 'doorbell'

interface SimEvent extends HistoryEvent {
  scene: SimScene
}

const state = {
  porch: 'empty' as SimScene,
  driveway: 'driveway_empty' as SimScene,
  history: [] as SimEvent[],
}

const ACTIONS: Record<SimAction, { device: string; type: 'motion' | 'ding'; sub: string; scene: SimScene; after?: SimScene }> = {
  aide_arrives: { device: SIM_DEVICES.door, type: 'motion', sub: 'human', scene: 'aide_arrive', after: 'empty' },
  aide_leaves: { device: SIM_DEVICES.door, type: 'motion', sub: 'human', scene: 'aide_leave', after: 'empty' },
  delivery: { device: SIM_DEVICES.door, type: 'motion', sub: 'package_delivery', scene: 'courier', after: 'package' },
  package_collected: { device: SIM_DEVICES.door, type: 'motion', sub: 'human', scene: 'resident', after: 'empty' },
  meals: { device: SIM_DEVICES.door, type: 'ding', sub: 'ding', scene: 'meals', after: 'empty' },
  resident_out: { device: SIM_DEVICES.door, type: 'motion', sub: 'human', scene: 'resident', after: 'empty' },
  night_visitor: { device: SIM_DEVICES.door, type: 'motion', sub: 'human', scene: 'night', after: 'empty' },
  car_arrives: { device: SIM_DEVICES.driveway, type: 'motion', sub: 'vehicle', scene: 'car', after: 'car' },
  doorbell: { device: SIM_DEVICES.door, type: 'ding', sub: 'ding', scene: 'aide_arrive', after: 'empty' },
}

export function simulate(action: SimAction, at = Date.now()): SimEvent {
  const a = ACTIONS[action]
  const event: SimEvent = {
    id: `sim_${at.toString(36)}_${action}`,
    eventType: a.type,
    subType: a.sub,
    start: at,
    end: at + 20_000,
    deviceId: a.device,
    reviewed: false,
    scene: a.scene,
  }
  state.history.unshift(event)
  // After the event's own frame, the doorstep settles into its new state (e.g. the package stays).
  setTimeout(() => {
    if (a.device === SIM_DEVICES.door && a.after) state.porch = a.after
    if (a.device === SIM_DEVICES.driveway && a.after) state.driveway = a.after
  }, 15_000).unref()
  if (a.device === SIM_DEVICES.door && action === 'package_collected') state.porch = 'empty'
  return event
}

export function simPorch(scene: SimScene) {
  state.porch = scene
}

function sceneImage(scene: SimScene): Buffer {
  const file = join(ROOT, 'server', 'assets', 'sim', `${scene === 'driveway_empty' ? 'car' : scene}.jpg`)
  if (!existsSync(file)) throw new RingApiError(404, `Simulator image missing: ${scene}`)
  return readFileSync(file)
}

const image = (scene: SimScene, ts: number): MediaResult => ({
  bytes: sceneImage(scene),
  contentType: 'image/jpeg',
  mediaTimestamp: ts,
  origin: 'snapshot',
})

export const simApi: RingApi = {
  kind: 'sim',

  async listDevices(): Promise<DeviceBundle[]> {
    const dev = (id: string, name: string, status: Record<string, unknown>, caps: Record<string, unknown>, configs: Record<string, unknown>): DeviceBundle => ({
      device: { type: 'devices', id, attributes: { name } },
      status: { type: 'device-status', id: `${id}.status`, attributes: status },
      capabilities: { type: 'device-capabilities', id: `${id}.caps`, attributes: caps },
      configurations: { type: 'device-configurations', id: `${id}.cfg`, attributes: configs },
    })
    const camCaps = { video: { codecs: ['AVC'], ratio: '16:9', max_resolution: 1080 }, motion_detection: { configurations: ['enabled', 'motion_zones'] } }
    return [
      dev(SIM_DEVICES.door, 'Front Door', { online: true, battery_status: { percentage: 82 }, power_source: 'battery' }, camCaps, {
        e2e_encryption: { enabled: false },
        motion_detection: { enabled: 'on', motion_zones: [{ id: 'z1' }, { id: 'z2' }] },
        privacy_zones: [{ id: 'p1' }],
      }),
      dev(SIM_DEVICES.driveway, 'Driveway', { online: true, power_source: 'wired' }, camCaps, {
        e2e_encryption: { enabled: false },
        motion_detection: { enabled: 'on', motion_zones: [{ id: 'z1' }] },
      }),
      dev(SIM_DEVICES.chime, 'Hallway Chime', { online: true, audio: { snooze: { active: false, until: null } } }, { audio: { customizable_slots: 2 } }, {
        audio: {
          volume: 4,
          customizable_slots: [
            { event: 'ring-appstore-event-2', disabled: false, audio_ref: 'sim-ref-2', audio_name: 'Navi' },
            { event: 'ring-appstore-event-1', disabled: false, audio_ref: 'sim-ref-1', audio_name: 'Ring Alert 3' },
          ],
        },
      }),
    ]
  },

  async getHistory(deviceId) {
    return state.history.filter((e) => e.deviceId === deviceId)
  },

  async snapshot(deviceId, req) {
    const ts = req.type === 'at_timestamp' ? req.timestamp : (req.end ?? Date.now())
    if (deviceId === SIM_DEVICES.chime) throw new RingApiError(400, 'A chime has no camera')
    // A frame at an event's time shows that event's scene; otherwise the current state of the doorstep.
    const hit = state.history.find((e) => e.deviceId === deviceId && ts >= e.start - 2_000 && ts <= (e.end ?? e.start) + 2_000)
    if (hit && req.type === 'at_timestamp') return image(hit.scene, ts)
    return image(deviceId === SIM_DEVICES.driveway ? state.driveway : state.porch, ts)
  },

  async clip() {
    throw new RingApiError(501, 'Clips are not available in the offline simulator')
  },

  async whepOffer() {
    throw new RingApiError(501, 'Live view needs a Ring device or the Ring Developer Playground')
  },

  async whepClose() {},

  async playChime(deviceId, audioRef) {
    if (deviceId !== SIM_DEVICES.chime || !audioRef.startsWith('sim-ref')) throw new RingApiError(400, 'Unknown chime slot')
  },

  async usersMe() {
    return { accountId: 'sim.ring.account.demo', email: 'priya@example.com', name: 'Priya Rao' }
  },
}
