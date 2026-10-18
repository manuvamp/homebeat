// Time helpers. Everything shown to the family is in the household timezone.

let clockOffset = 0
/** Mock mode pins a demo clock (e.g. "today at 14:20"); real mode uses the wall clock. */
export function setClockOffset(ms: number) {
  clockOffset = ms
}
export function now() {
  return Date.now() + clockOffset
}

let householdTz = 'America/Los_Angeles'
export function setHouseholdTz(tz: string) {
  householdTz = tz
}
export function getHouseholdTz() {
  return householdTz
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(opts: Intl.DateTimeFormatOptions, tz = householdTz) {
  const key = tz + JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts })
    fmtCache.set(key, f)
  }
  return f
}

/** "9:04 AM" */
export function formatTime(at: number) {
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(at)
}
/** "Mon, Oct 19" */
export function formatDay(at: number) {
  return fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(at)
}
/** "Monday, October 19" */
export function formatLongDay(at: number) {
  return fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(at)
}
export function formatWeekday(at: number, style: 'short' | 'long' = 'short') {
  return fmt({ weekday: style }).format(at)
}

/** Parts of an instant in a timezone. */
export function zonedParts(at: number, tz = householdTz) {
  const parts = fmt(
    { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' },
    tz,
  ).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return {
    year: +get('year'),
    month: +get('month'),
    day: +get('day'),
    hour: +get('hour') % 24,
    minute: +get('minute'),
    second: +get('second'),
    weekday: wd,
  }
}

/** YYYY-MM-DD for an instant, in the household timezone. */
export function dateKey(at: number, tz = householdTz) {
  const p = zonedParts(at, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Epoch ms for a wall-clock time ("09:00") on a household date ("2026-10-19"). */
export function zonedTime(date: string, hhmm: string, tz = householdTz) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  // Correct by the zone offset at that instant (twice handles DST edges).
  let t = guess
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(t, tz)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    t = guess - (asUtc - t)
  }
  return t
}

/** Shift a YYYY-MM-DD by n days. */
export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}
/** Weekday (0=Sun) of a YYYY-MM-DD. */
export function weekdayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
/** "Mon, Oct 19" for a YYYY-MM-DD. */
export function formatDateKey(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(Date.UTC(y, m - 1, d, 12))
}
export function todayKey() {
  return dateKey(now())
}
/** "Today", "Yesterday" or "Sat, Oct 17". */
export function relativeDayLabel(date: string) {
  const t = todayKey()
  if (date === t) return 'Today'
  if (date === addDays(t, -1)) return 'Yesterday'
  if (date === addDays(t, 1)) return 'Tomorrow'
  return formatDateKey(date)
}

/** "just now", "12 min ago", "3 h ago", "yesterday 9:04 AM" */
export function relativeTime(at: number, ref = now()) {
  const diff = ref - at
  const abs = Math.abs(diff)
  const min = Math.round(abs / 60000)
  if (diff >= 0) {
    if (min < 1) return 'just now'
    if (min < 60) return `${min} min ago`
    const h = Math.floor(min / 60)
    if (h < 6 && dateKey(at) === dateKey(ref)) return `${h} h ${min % 60 ? `${min % 60} min ` : ''}ago`
  } else {
    if (min < 1) return 'any moment'
    if (min < 60) return `in ${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `in ${h} h${min % 60 ? ` ${min % 60} min` : ''}`
    if (h < 36) return `in ${h} h`
    return `in ${Math.round(h / 24)} days`
  }
  const day = dateKey(at)
  const today = dateKey(ref)
  if (day === today) return `today ${formatTime(at)}`
  if (day === addDays(today, -1)) return `yesterday ${formatTime(at)}`
  if (day === addDays(today, 1)) return `tomorrow ${formatTime(at)}`
  return `${formatDay(at)}, ${formatTime(at)}`
}

/** "54 min", "1 h 05 min" */
export function formatDuration(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

/** "9:00 AM" from "09:00" without tz math. */
export function formatClock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

export type DayPart = 'Night' | 'Evening' | 'Afternoon' | 'Morning' | 'Early hours'
export function dayPart(at: number): DayPart {
  const h = zonedParts(at).hour
  if (h < 5) return 'Early hours'
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  if (h < 21) return 'Evening'
  return 'Night'
}

export function greeting(at = now()) {
  const h = zonedParts(at).hour
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function formatMoney(usd: number) {
  if (usd < 0.01 && usd > 0) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(2)}`
}
