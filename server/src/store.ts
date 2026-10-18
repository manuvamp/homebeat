import type { Analysis, Device, Household, Moment, Rule, Schedule, Visit } from '../../shared/types.ts'
import { config } from './config.ts'
import { collection, getSetting, setSetting } from './db.ts'

export interface RingEventRecord {
  id: string
  deviceId: string
  at: number
  endAt?: number
  kind: 'motion' | 'ding' | 'on_demand' | 'other'
  subType: string // open vocabulary: motion, human, vehicle, package_delivery, other_motion, animal, ...
  source: 'webhook' | 'history' | 'sim'
  requestId?: string
  componentIds?: string[]
}

export const moments = collection<Moment>('moments', { at: (m) => m.at, kind: (m) => m.kind })
export const visits = collection<Visit>('visits', { date: (v) => v.date, schedule_id: (v) => v.scheduleId })
export const schedules = collection<Schedule>('schedules')
export const rules = collection<Rule>('rules')
export const devices = collection<Device>('devices')
export const events = collection<RingEventRecord>('events', {
  device_id: (e) => e.deviceId,
  at: (e) => e.at,
  kind: (e) => e.kind,
  sub_type: (e) => e.subType,
  source: (e) => e.source,
})
export const analyses = collection<Analysis>('analyses', { event_id: (a) => a.eventId, at: (a) => a.startedAt })

const defaultHousehold: Household = {
  id: 'h1',
  parentName: 'Asha',
  homeName: "Asha's home",
  timezone: config.household.timezone,
  members: [
    { id: 'm1', name: 'Priya', relation: 'Daughter', role: 'primary', escalationOrder: 1 },
    { id: 'm2', name: 'Rohan', relation: 'Son', role: 'family', escalationOrder: 2 },
  ],
  quietHours: { start: '21:30', end: '06:00' },
  ringMode: 'offline_sim',
}

export const household = {
  get: () => getSetting<Household>('household', defaultHousehold),
  set: (h: Household) => setSetting('household', h),
  patch: (p: Partial<Household>) => setSetting('household', { ...household.get(), ...p }),
}
