// Household-timezone helpers (schedules and quiet hours are wall-clock times in the parent's timezone).
import { household } from './store.ts'

const tz = () => household.get().timezone

function parts(ts: number, timeZone = tz()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]))
  return p as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'weekday', string>
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function localDate(ts: number): string {
  const p = parts(ts)
  return `${p.year}-${p.month}-${p.day}`
}

export function localMinutes(ts: number): number {
  const p = parts(ts)
  return Number(p.hour) * 60 + Number(p.minute)
}

export function localWeekday(ts: number): number {
  return WEEKDAYS.indexOf(parts(ts).weekday)
}

export const hhmmToMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

// Epoch ms for a wall-clock time on a household date. Two passes handle DST transitions.
export function atLocal(date: string, hhmm: string): number {
  const [y, mo, d] = date.split('-').map(Number)
  const minutes = hhmmToMinutes(hhmm)
  let guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60)
  for (let i = 0; i < 2; i++) {
    const p = parts(guess)
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute))
    guess += Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60) - asUtc
  }
  return guess
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// True when `ts` falls inside a window that may wrap midnight (e.g. 21:30 -> 06:00).
export function inWindow(ts: number, start: string, end: string): boolean {
  const m = localMinutes(ts)
  const s = hhmmToMinutes(start)
  const e = hhmmToMinutes(end)
  return s <= e ? m >= s && m < e : m >= s || m < e
}

export function clock(ts: number): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' }).format(new Date(ts))
}
