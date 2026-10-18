// Ring webhook receiver (Notifications v1.1).
// Rules from the docs this follows: verify X-Signature (HMAC-SHA256, hex, "sha256=" prefix) over the RAW body
// before parsing; answer 200 within 5 s; dedupe on meta.request_id; do CV work in the background.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '../db.ts'

export function verifySignature(hmacKey: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!hmacKey || !header) return false
  const received = header.trim().replace(/^sha256=/i, '')
  const expected = createHmac('sha256', hmacKey).update(rawBody).digest('hex')
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'))
}

export interface WebhookPayload {
  meta?: { version?: string; time?: string; request_id?: string; account_id?: string }
  data?: {
    id?: string
    type?: string
    attributes?: {
      source?: string
      source_type?: string
      timestamp?: number
      sub_type?: string
      component_ids?: string[]
      [key: string]: unknown
    }
  }
}

// Returns true the first time a request_id is seen (Ring retries deliveries, so duplicates are normal).
export function firstDelivery(requestId: string | undefined): boolean {
  if (!requestId) return true
  const result = db.prepare('INSERT OR IGNORE INTO webhook_seen (request_id, at) VALUES (?, ?)').run(requestId, Date.now())
  return Number(result.changes) > 0
}
