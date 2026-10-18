import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

process.env.HOMEBEAT_DB = join(mkdtempSync(join(tmpdir(), 'hb-')), 'test.db')
process.env.HOUSEHOLD_TZ = 'America/Los_Angeles'

const { verifySignature, firstDelivery } = await import('../src/ring/webhook.ts')
const { computeNonce, checkFreshness, maskEmail, NONCE_WINDOW_SEC } = await import('../src/ring/linking.ts')
const { normalizeDevice } = await import('../src/ring/index.ts')

describe('webhook signature (X-Signature, HMAC-SHA256 hex)', () => {
  const key = 'test-signing-key'
  const body = Buffer.from('{"meta":{"request_id":"r1"},"data":{"type":"motion_detected"}}')
  const sig = createHmac('sha256', key).update(body).digest('hex')

  it('accepts the signature with or without the sha256= prefix', () => {
    expect(verifySignature(key, body, `sha256=${sig}`)).toBe(true)
    expect(verifySignature(key, body, sig)).toBe(true)
  })
  it('rejects a re-serialized body (whitespace changes the bytes)', () => {
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1))
    expect(verifySignature(key, reserialized, `sha256=${sig}`)).toBe(false)
  })
  it('rejects a wrong key, a missing header and a truncated signature', () => {
    expect(verifySignature('other', body, `sha256=${sig}`)).toBe(false)
    expect(verifySignature(key, body, undefined)).toBe(false)
    expect(verifySignature(key, body, `sha256=${sig.slice(0, 10)}`)).toBe(false)
  })
  it('deduplicates retried deliveries by request_id', () => {
    expect(firstDelivery('req-1')).toBe(true)
    expect(firstDelivery('req-1')).toBe(false)
    expect(firstDelivery(undefined)).toBe(true)
  })
})

describe('account-linking nonce (base64url HMAC of "<time>:<account_id>")', () => {
  it('matches the documented algorithm with url-safe, unpadded base64', () => {
    const nonce = computeNonce('1771130906289', 'ava1.ring.account.XXXYYY', 'k')
    const expected = createHmac('sha256', 'k').update('1771130906289:ava1.ring.account.XXXYYY').digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(nonce).toBe(expected)
    expect(nonce).not.toMatch(/[+/=]/)
  })
  it('enforces the 10-minute window and rejects future times', () => {
    const now = 1_800_000_000_000
    expect(checkFreshness(String(now - 60_000), now)).toBeNull()
    expect(checkFreshness(String(now - (NONCE_WINDOW_SEC + 1) * 1000), now)).toMatch(/expired/)
    expect(checkFreshness(String(now + 5_000), now)).toMatch(/Invalid/)
  })
  it('masks the account identifier sent to app-integrations', () => {
    expect(maskEmail('priya@example.com')).toBe('p***a@example.com')
  })
})

describe('device normalization (JSON:API bundles)', () => {
  it('identifies a chime by audio.customizable_slots and sorts its slots', () => {
    const d = normalizeDevice({
      device: { type: 'devices', id: 'c1', attributes: { name: 'Upstairs' } },
      capabilities: { type: 'device-capabilities', id: 'x', attributes: { video: { codecs: null }, audio: { customizable_slots: 2 } } },
      configurations: {
        type: 'device-configurations',
        id: 'y',
        attributes: { audio: { customizable_slots: [{ event: 'ring-appstore-event-2', audio_name: 'Navi' }, { event: 'ring-appstore-event-1', audio_name: 'Alert' }] } },
      },
    })
    expect(d.kind).toBe('chime')
    expect(d.chimeSlots?.map((s) => s.event)).toEqual(['ring-appstore-event-1', 'ring-appstore-event-2'])
  })
  it('reads e2e_encryption as a JSON boolean and battery from status', () => {
    const d = normalizeDevice({
      device: { type: 'devices', id: 'd1', attributes: { name: 'Front Door' } },
      status: { type: 'device-status', id: 's', attributes: { online: true, battery_status: { percentage: 64 } } },
      capabilities: { type: 'device-capabilities', id: 'c', attributes: { video: { codecs: ['AVC'] } } },
      configurations: { type: 'device-configurations', id: 'g', attributes: { e2e_encryption: { enabled: true }, motion_detection: { enabled: 'on', motion_zones: [{}, {}] } } },
    })
    expect(d).toMatchObject({ kind: 'doorbell', online: true, battery: 64, encrypted: true, motionZones: 2, maxLiveSeconds: 30 })
  })
  it('ignores out-of-range battery values and treats "on" strings as not encrypted', () => {
    const d = normalizeDevice({
      device: { type: 'devices', id: 'd2', attributes: { name: 'Driveway' } },
      status: { type: 'device-status', id: 's', attributes: { online: false, battery_status: { percentage: 255 } } },
      capabilities: { type: 'device-capabilities', id: 'c', attributes: { video: { codecs: ['AVC'] } } },
      configurations: { type: 'device-configurations', id: 'g', attributes: { e2e_encryption: { enabled: 'on' } } },
    })
    expect(d).toMatchObject({ kind: 'camera', online: false, battery: null, encrypted: false })
  })
})
