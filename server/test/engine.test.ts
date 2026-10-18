// Decisions that came out of running against the real Ring Developer Playground (friction log #11-#15).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

process.env.HOMEBEAT_DB = join(mkdtempSync(join(tmpdir(), 'hb-')), 'test.db')
process.env.HOUSEHOLD_TZ = 'America/Los_Angeles'
process.env.AI_PROVIDER = 'none'

const { frameTime, matchVisit, ringErrorText } = await import('../src/care/engine.ts')
const { isOwnLive, noteOwnLive } = await import('../src/ring/index.ts')
const { mediaFloor, usePlaygroundToken, clearToken } = await import('../src/ring/auth.ts')

const event = (over: Record<string, unknown> = {}) => ({ id: 'e1', deviceId: 'd1', at: 1_792_357_107_509, kind: 'motion' as const, subType: 'unknown', source: 'history' as const, ...over })
const schedule = { id: 's_aide', label: 'Home aide', who: 'Maria (BrightCare)', visitorType: 'care_worker' as const, days: [0, 1, 2, 3, 4, 5, 6], windowStart: '09:00', windowEnd: '09:15', graceMin: 30, expectedMinutes: 55, vehicleHint: 'silver hatchback', active: true }
const open = [{ visit: { id: 'v1', scheduleId: 's_aide', label: 'Home aide', who: schedule.who, date: '2026-10-19', expectedStart: 0, expectedEnd: 0, status: 'due' as const, evidence: [] }, schedule }]

describe('which frame to look at', () => {
  it('a live trigger: a beat after it starts', () => {
    expect(frameTime(event())).toBe(1_792_357_107_509 + 1500)
  })
  it('a finished Playground event: a third of the way in, in whole milliseconds', () => {
    const t = frameTime(event({ endAt: 1_792_357_139_253 })) // the 31.7 s package clip
    expect(Number.isInteger(t)).toBe(true) // Ring answers 403 "invalid request body" to a fractional timestamp
    expect(t - 1_792_357_107_509).toBe(9523)
  })
})

describe('reading Ring media errors', () => {
  it('turns the JSON:API error into code and detail', () => {
    const err = new Error('Ring media 416: {"errors":[{"status":"416","code":"MEDIA_NOT_FOUND","detail":"No media found in time range 1-2"}]}')
    expect(ringErrorText(err)).toBe('416 MEDIA_NOT_FOUND: No media found in time range 1-2')
  })
})

describe('matching an event to an expected visit', () => {
  it('a parcel alone is never the aide arriving, even if the model offers the schedule id', () => {
    expect(matchVisit({ people: 0, packagePresent: true, scheduleId: 's_aide', description: 'A box', confidence: 0.8 }, open, event())).toBeUndefined()
  })
  it("the aide's car matches the visit", () => {
    expect(matchVisit({ vehicle: 'silver hatchback', scheduleId: 's_aide', matchesExpected: true, description: 'Car', confidence: 0.87 }, open, event())?.visit.id).toBe('v1')
  })
  it('a care worker at the door matches by type', () => {
    expect(matchVisit({ people: 1, visitorType: 'care_worker', activity: 'arriving', description: 'Scrubs', confidence: 0.9 }, open, event())?.visit.id).toBe('v1')
  })
  it('the model saying it does not match wins over its schedule id', () => {
    expect(matchVisit({ people: 1, visitorType: 'unknown', scheduleId: 's_aide', matchesExpected: false, description: 'Someone', confidence: 0.6 }, open, event())).toBeUndefined()
  })
})

describe("telling Homebeat's own live views from Playground events", () => {
  it('an on_demand event inside a session Homebeat opened is ours', () => {
    noteOwnLive('d1', 1_000_000, 1_049_000)
    expect(isOwnLive('d1', 1_002_500)).toBe(true)
    expect(isOwnLive('d1', 1_200_000)).toBe(false)
    expect(isOwnLive('d2', 1_002_500)).toBe(false)
  })
})

describe('Playground media window', () => {
  it("snapshot ranges start no earlier than the token's iat", () => {
    const payload = Buffer.from(JSON.stringify({ iat: 1_792_356_923, exp: 1_792_358_723 })).toString('base64url')
    usePlaygroundToken(`eyJhbGciOiJSUzI1NiJ9.${payload}.sig`)
    expect(mediaFloor()).toBe(1_792_356_923_000)
    clearToken()
    expect(mediaFloor()).toBe(0)
  })
})
