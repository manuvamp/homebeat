// Privacy promise in the app: snapshots are kept 30 days, then deleted. Raw events keep no images at all.
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../config.ts'
import { db } from '../db.ts'

export const RETENTION_DAYS = 30

export function pruneOldData(now = Date.now()) {
  const cutoff = now - RETENTION_DAYS * 86_400_000
  const dir = join(config.dataDir, 'media')
  let removed = 0
  for (const file of readdirSync(dir)) {
    if (file.startsWith('sample_')) continue
    const path = join(dir, file)
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path)
      removed++
    }
  }
  db.prepare('DELETE FROM analyses WHERE at < ?').run(cutoff)
  db.prepare('DELETE FROM events WHERE at < ?').run(cutoff)
  db.prepare('DELETE FROM webhook_seen WHERE at < ?').run(now - 7 * 86_400_000)
  db.prepare('DELETE FROM jobs WHERE done = 1 AND due_at < ?').run(cutoff)
  return removed
}
