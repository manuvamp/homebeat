// Moments are what the family sees. Creating one publishes it live and, for heads-up/urgent ones,
// notifies the primary family member and starts the escalation ladder.
import type { Moment, Severity } from '../../../shared/types.ts'
import { publish } from '../bus.ts'
import { config } from '../config.ts'
import { getSetting, setSetting, uid } from '../db.ts'
import { household, moments } from '../store.ts'
import { schedule } from './jobs.ts'

const RANK: Record<Severity, number> = { calm: 0, note: 1, heads_up: 2, urgent: 3 }

export function createMoment(m: Omit<Moment, 'id' | 'eventIds' | 'ack' | 'feedback'> & { eventIds?: string[] }): Moment {
  const moment: Moment = { id: uid('mo'), eventIds: [], ack: null, feedback: null, ...m }
  moments.put(moment)
  publish({ type: 'moment', moment })
  if (RANK[moment.severity] >= RANK.heads_up && !moment.sample) {
    void notify(moment, 1)
    if (moment.severity === 'urgent') schedule('escalate', Date.now() + escalateAfterMs(), { momentId: moment.id, level: 2 })
  }
  return moment
}

export function updateMoment(id: string, patch: Partial<Moment>): Moment | undefined {
  const existing = moments.get(id)
  if (!existing) return undefined
  const updated = { ...existing, ...patch }
  moments.put(updated)
  publish({ type: 'moment_updated', moment: updated })
  return updated
}

export const escalateAfterMs = () => Number(process.env.ESCALATE_AFTER_MS ?? household.get().escalateAfterMin * 60_000)

// Delivery channels: always the in-app stream (above); optionally an ntfy.sh topic for phone pushes.
export async function notify(moment: Moment, level: number) {
  const member = household.get().members.find((m) => m.escalationOrder === level)
  if (!member) return
  const stats = getSetting('notify_stats', { notified: 0 })
  setSetting('notify_stats', { notified: stats.notified + 1 })
  const ntfy = process.env.NTFY_URL
  if (!ntfy) return
  try {
    await fetch(ntfy, {
      method: 'POST',
      headers: {
        Title: moment.title,
        Priority: moment.severity === 'urgent' ? 'urgent' : 'high',
        Tags: moment.severity === 'urgent' ? 'rotating_light' : 'house',
        Click: `${config.publicUrl}/moment/${moment.id}`,
        ...(moment.snapshotUrl ? { Attach: `${config.publicUrl}${moment.snapshotUrl}` } : {}),
      },
      body: `${level > 1 ? `${household.get().members.find((m) => m.escalationOrder === 1)?.name ?? 'The family'} hasn't seen this yet. ` : ''}${moment.body}`,
    })
  } catch {
    /* a push failure never blocks the app */
  }
}

export async function escalate(momentId: string, level: number) {
  const moment = moments.get(momentId)
  if (!moment || moment.ack) return
  const members = household.get().members.sort((a, b) => a.escalationOrder - b.escalationOrder)
  const next = members.find((m) => m.escalationOrder === level)
  if (!next) return
  await notify(moment, level)
  updateMoment(momentId, { body: `${moment.body} ${members[0].name} hasn't opened this yet, so Homebeat also told ${next.name}.` })
  schedule('escalate', Date.now() + escalateAfterMs(), { momentId, level: level + 1 })
}
