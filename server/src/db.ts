import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'

mkdirSync(config.dataDir, { recursive: true })
mkdirSync(join(config.dataDir, 'media'), { recursive: true })

export const db = new DatabaseSync(process.env.HOMEBEAT_DB ?? join(config.dataDir, 'homebeat.db'))
db.exec('PRAGMA journal_mode = WAL')

// Each table keeps the full object as JSON plus the few columns we filter or sort on.
db.exec(`
  CREATE TABLE IF NOT EXISTS moments  (id TEXT PRIMARY KEY, at INTEGER, kind TEXT, json TEXT);
  CREATE INDEX IF NOT EXISTS moments_at ON moments(at);
  CREATE TABLE IF NOT EXISTS visits   (id TEXT PRIMARY KEY, date TEXT, schedule_id TEXT, json TEXT);
  CREATE INDEX IF NOT EXISTS visits_date ON visits(date);
  CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE IF NOT EXISTS rules    (id TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE IF NOT EXISTS devices  (id TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE IF NOT EXISTS events   (id TEXT PRIMARY KEY, device_id TEXT, at INTEGER, kind TEXT, sub_type TEXT, source TEXT, json TEXT);
  CREATE INDEX IF NOT EXISTS events_at ON events(at);
  CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, event_id TEXT, at INTEGER, json TEXT);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT);
  CREATE TABLE IF NOT EXISTS webhook_seen (request_id TEXT PRIMARY KEY, at INTEGER);
  CREATE TABLE IF NOT EXISTS ring_tokens (account_id TEXT PRIMARY KEY, claimed INTEGER, json TEXT);
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, due_at INTEGER, kind TEXT, done INTEGER DEFAULT 0, json TEXT);
  CREATE INDEX IF NOT EXISTS jobs_due ON jobs(done, due_at);
`)

type Row = { json: string }
const parse = <T>(row: unknown): T => JSON.parse((row as Row).json) as T

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT json FROM settings WHERE key = ?').get(key)
  return row ? parse<T>(row) : fallback
}

export function setSetting<T>(key: string, value: T): T {
  db.prepare('INSERT INTO settings (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(
    key,
    JSON.stringify(value),
  )
  return value
}

// Generic JSON collection with an id and optional indexed columns.
export function collection<T extends { id: string }>(table: string, columns: Record<string, (item: T) => unknown> = {}) {
  const cols = Object.keys(columns)
  const insert = db.prepare(
    `INSERT INTO ${table} (id, ${[...cols, 'json'].join(', ')}) VALUES (?, ${[...cols, 'json'].map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${[...cols, 'json'].map((c) => `${c} = excluded.${c}`).join(', ')}`,
  )
  return {
    get(id: string): T | undefined {
      const row = db.prepare(`SELECT json FROM ${table} WHERE id = ?`).get(id)
      return row ? parse<T>(row) : undefined
    },
    put(item: T): T {
      insert.run(item.id, ...cols.map((c) => (columns[c](item) ?? null) as never), JSON.stringify(item))
      return item
    },
    remove(id: string) {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    },
    all(where = '', ...params: (string | number)[]): T[] {
      return db
        .prepare(`SELECT json FROM ${table} ${where}`)
        .all(...params)
        .map((r) => parse<T>(r))
    },
    count(where = '', ...params: (string | number)[]): number {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...params) as { n: number }
      return row.n
    },
  }
}

export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
