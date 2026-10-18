// One-way (Ring-driven) account linking:
//  1. Ring POSTs an authorization code to our Token Exchange URL -> we swap it within 60 s and keep the
//     token "unclaimed", keyed by the Ring Account ID from GET /v1/users/me.
//  2. Ring sends the user to our Account Link URL with ?nonce=&time= . The user confirms who they are
//     (one tap, email pre-filled from the Users API: the UX guide's passwordless pattern), then we match
//     the nonce = base64url(HMAC-SHA256(key, "<time>:<account_id>")) against unclaimed tokens,
//     POST app-integrations {account_identifier, nonce} and PATCH {status: completed}.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.ts'
import { db } from '../db.ts'
import { useLinkedTokens } from './auth.ts'
import { appIntegrations, ringApi } from './client.ts'

export const NONCE_WINDOW_SEC = 600

interface TokenRecord {
  accountId: string
  email?: string
  name?: string
  accessToken: string
  refreshToken: string
  expiresIn: number
  receivedAt: number
}

export function computeNonce(time: string, accountId: string, hmacKey: string): string {
  return createHmac('sha256', hmacKey).update(`${time}:${accountId}`, 'utf8').digest('base64url')
}

export function checkFreshness(time: string, now = Date.now()): string | null {
  const t = Number(time)
  if (!Number.isFinite(t)) return 'Invalid link time'
  const delta = (now - t) / 1000
  if (delta > NONCE_WINDOW_SEC) return 'This link has expired. Open Homebeat from the Ring app again.'
  if (delta < 0) return 'Invalid link time'
  return null
}

export async function exchangeCode(code: string): Promise<TokenRecord> {
  const res = await fetch(`${config.ring.oauthBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.ring.clientId,
      client_secret: config.ring.clientSecret,
    }),
  })
  if (!res.ok) throw new Error(`Code exchange failed (${res.status})`)
  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  const me = await ringApi.usersMe(body.access_token)
  const record: TokenRecord = {
    accountId: me.accountId,
    email: me.email,
    name: me.name,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    receivedAt: Date.now(),
  }
  db.prepare(
    'INSERT INTO ring_tokens (account_id, claimed, json) VALUES (?, 0, ?) ON CONFLICT(account_id) DO UPDATE SET claimed = 0, json = excluded.json',
  ).run(record.accountId, JSON.stringify(record))
  return record
}

export function unclaimedTokens(): TokenRecord[] {
  return db
    .prepare('SELECT json FROM ring_tokens WHERE claimed = 0')
    .all()
    .map((r) => JSON.parse((r as { json: string }).json) as TokenRecord)
}

export function matchNonce(nonce: string, time: string, hmacKey = config.ring.hmacKey): TokenRecord | null {
  const received = Buffer.from(nonce)
  for (const record of unclaimedTokens()) {
    const computed = Buffer.from(computeNonce(time, record.accountId, hmacKey))
    if (computed.length === received.length && timingSafeEqual(computed, received)) return record
  }
  return null
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  return `${user[0]}***${user.length > 1 ? user[user.length - 1] : ''}@${domain}`
}

// Shown on the Account Link page before the user confirms: the email we will create their account with.
export function previewForNonce(nonce: string, time: string) {
  const record = matchNonce(nonce, time)
  return record ? { email: record.email, name: record.name } : null
}

export async function completeLink(nonce: string, time: string, email: string) {
  const stale = checkFreshness(time)
  if (stale) throw new Error(stale)
  const record = matchNonce(nonce, time)
  if (!record) throw new Error('We could not match this link to your Ring account. Open Homebeat from the Ring app again.')
  await appIntegrations(record.accessToken, 'POST', { account_identifier: maskEmail(email), nonce })
  await appIntegrations(record.accessToken, 'PATCH', { status: 'completed' })
  db.prepare('UPDATE ring_tokens SET claimed = 1 WHERE account_id = ?').run(record.accountId)
  useLinkedTokens(record.accessToken, record.refreshToken, record.expiresIn)
  return record
}
