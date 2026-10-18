import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

process.env.HOMEBEAT_DB = join(mkdtempSync(join(tmpdir(), 'hb-')), 'test.db')
process.env.HOUSEHOLD_TZ = 'America/Los_Angeles'
process.env.AI_PROVIDER = 'none'

const { fallbackCompile } = await import('../src/care/rules.ts')
const { atLocal, inWindow, localDate, localMinutes } = await import('../src/time.ts')

describe('plain-English rules without a model (fallback compiler)', () => {
  it('package rules get minutes and a chime nudge', () => {
    const r = fallbackCompile('Tell me if a parcel sits outside for more than 40 minutes', 'Asha')
    expect(r.template).toBe('package_waiting')
    expect(r.params.minutes).toBe(40)
    expect(r.actions.some((a) => a.type === 'chime')).toBe(true)
  })
  it('night rules become urgent quiet hours with 24h times', () => {
    const r = fallbackCompile('Anyone at the door between 10pm and 6am at night', 'Asha')
    expect(r).toMatchObject({ template: 'quiet_hours', severity: 'urgent', params: { start: '22:00', end: '06:00' } })
  })
  it('visit rules parse days and the arrival window', () => {
    const r = fallbackCompile('The nurse Joan comes on weekdays between 2:30pm and 3pm', 'Asha')
    expect(r).toMatchObject({ template: 'expected_visit', params: { days: [1, 2, 3, 4, 5], windowStart: '14:30', windowEnd: '15:00' } })
  })
  it('a visit with one time gets a 15-minute window that can cross the hour', () => {
    const r = fallbackCompile('Expect the cleaner Ana every day at 9:50am', 'Asha')
    expect(r.params).toMatchObject({ windowStart: '09:50', windowEnd: '10:05' })
  })
  it('anything else becomes a yes/no question for the vision model', () => {
    const r = fallbackCompile('Let me know if someone in a high-vis vest comes by', 'Asha')
    expect(r.template).toBe('custom_watch')
    expect(String(r.params.question)).toMatch(/high-vis vest/)
  })
})

describe('household-time helpers', () => {
  it('atLocal round-trips a wall-clock time across DST', () => {
    for (const date of ['2026-03-08', '2026-07-01', '2026-11-01']) {
      const ts = atLocal(date, '09:00')
      expect(localDate(ts)).toBe(date)
      expect(localMinutes(ts)).toBe(9 * 60)
    }
  })
  it('quiet-hours windows wrap midnight', () => {
    expect(inWindow(atLocal('2026-10-19', '23:10'), '21:30', '06:00')).toBe(true)
    expect(inWindow(atLocal('2026-10-19', '03:00'), '21:30', '06:00')).toBe(true)
    expect(inWindow(atLocal('2026-10-19', '12:00'), '21:30', '06:00')).toBe(false)
    expect(inWindow(atLocal('2026-10-19', '09:05'), '09:00', '09:15')).toBe(true)
  })
})
