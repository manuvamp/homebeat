// Persistent delayed work (package re-checks, escalations, parked-vehicle checks). Survives restarts.
import { db, uid } from '../db.ts'

export type JobKind = 'package_check' | 'escalate' | 'vehicle_check'
type Handler = (payload: any) => Promise<void> | void

const handlers = new Map<JobKind, Handler>()

export function onJob(kind: JobKind, handler: Handler) {
  handlers.set(kind, handler)
}

export function schedule(kind: JobKind, dueAt: number, payload: unknown) {
  const id = uid('job')
  db.prepare('INSERT INTO jobs (id, due_at, kind, done, json) VALUES (?, ?, ?, 0, ?)').run(id, dueAt, kind, JSON.stringify(payload))
  return id
}

export function cancelJobs(kind: JobKind, match: (payload: any) => boolean) {
  const rows = db.prepare('SELECT id, json FROM jobs WHERE done = 0 AND kind = ?').all(kind) as { id: string; json: string }[]
  for (const r of rows) if (match(JSON.parse(r.json))) db.prepare('UPDATE jobs SET done = 1 WHERE id = ?').run(r.id)
}

export function pendingJobs(kind: JobKind) {
  return (db.prepare('SELECT due_at, json FROM jobs WHERE done = 0 AND kind = ?').all(kind) as { due_at: number; json: string }[]).map((r) => ({
    dueAt: r.due_at,
    payload: JSON.parse(r.json),
  }))
}

let running = false
export async function runDueJobs(now = Date.now()) {
  if (running) return
  running = true
  try {
    const due = db.prepare('SELECT id, kind, json FROM jobs WHERE done = 0 AND due_at <= ? ORDER BY due_at').all(now) as { id: string; kind: JobKind; json: string }[]
    for (const job of due) {
      db.prepare('UPDATE jobs SET done = 1 WHERE id = ?').run(job.id)
      try {
        await handlers.get(job.kind)?.(JSON.parse(job.json))
      } catch (err) {
        console.error(`[jobs] ${job.kind} failed:`, (err as Error).message)
      }
    }
  } finally {
    running = false
  }
}
