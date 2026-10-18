// Ring access tokens. Two real modes, mirroring the official ring-api-helloworld sample:
//  - playground: a 30-minute access token from the Ring Developer Playground (no app, no linking)
//  - linked:     refresh token from account linking, renewed at https://oauth.ring.com/oauth/token
import { config } from '../config.ts'
import { getSetting, setSetting } from '../db.ts'

export class RingAuthError extends Error {}

interface TokenState {
  mode: 'playground' | 'linked' | 'none'
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  issuedAt?: number
}

const KEY = 'ring_token'

export function tokenState(): TokenState {
  const stored = getSetting<TokenState>(KEY, { mode: 'none' })
  if (stored.mode !== 'none') return stored
  if (config.ring.refreshToken) return { mode: 'linked', refreshToken: config.ring.refreshToken }
  if (config.ring.accessToken) return { mode: 'playground', accessToken: config.ring.accessToken, expiresAt: jwtExpiry(config.ring.accessToken), issuedAt: jwtClaim(config.ring.accessToken, 'iat') }
  return stored
}

// Playground tokens are JWTs; read `exp` (for the countdown) and `iat` when present.
function jwtClaim(token: string, claim: 'exp' | 'iat'): number | undefined {
  const part = token.split('.')[1]
  if (!part) return undefined
  try {
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return typeof payload[claim] === 'number' ? payload[claim] * 1000 : undefined
  } catch {
    return undefined
  }
}
export const jwtExpiry = (token: string) => jwtClaim(token, 'exp')

// A Playground token can only read media recorded after it was issued: earlier timestamps answer
// 403 TIME_RANGE_NOT_AUTHORIZED. Snapshot ranges are clamped to this.
export function mediaFloor(): number {
  const state = tokenState()
  return state.mode === 'playground' ? (state.issuedAt ?? 0) : 0
}

export function usePlaygroundToken(token: string) {
  // The Playground issues tokens valid for 30 minutes; fall back to that when the token is opaque.
  return setSetting<TokenState>(KEY, {
    mode: 'playground',
    accessToken: token.trim(),
    expiresAt: jwtExpiry(token) ?? Date.now() + 30 * 60_000,
    issuedAt: jwtClaim(token, 'iat'),
  })
}

export function useLinkedTokens(accessToken: string, refreshToken: string, expiresInSec: number) {
  return setSetting<TokenState>(KEY, { mode: 'linked', accessToken, refreshToken, expiresAt: Date.now() + expiresInSec * 1000 })
}

export function clearToken() {
  setSetting<TokenState>(KEY, { mode: 'none' })
}

let refreshing: Promise<string> | null = null

export async function getAccessToken(): Promise<string> {
  const state = tokenState()
  if (state.mode === 'playground') {
    if (!state.accessToken) throw new RingAuthError('No Ring token')
    if (state.expiresAt && Date.now() > state.expiresAt) throw new RingAuthError('Ring Playground token expired')
    return state.accessToken
  }
  if (state.mode === 'linked') {
    // Refresh proactively one minute before expiry; one refresh in flight at a time.
    if (state.accessToken && state.expiresAt && Date.now() < state.expiresAt - 60_000) return state.accessToken
    refreshing ??= refresh(state).finally(() => (refreshing = null))
    return refreshing
  }
  throw new RingAuthError('Ring is not connected')
}

async function refresh(state: TokenState): Promise<string> {
  if (!state.refreshToken || !config.ring.clientId || !config.ring.clientSecret) {
    throw new RingAuthError('Linked mode needs RING_REFRESH_TOKEN, RING_CLIENT_ID and RING_CLIENT_SECRET')
  }
  const res = await fetch(`${config.ring.oauthBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: state.refreshToken,
      client_id: config.ring.clientId,
      client_secret: config.ring.clientSecret,
    }),
  })
  if (!res.ok) throw new RingAuthError(`Token refresh failed (${res.status})`)
  const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
  // Ring rotates refresh tokens: always store the new one.
  useLinkedTokens(body.access_token, body.refresh_token ?? state.refreshToken, body.expires_in)
  return body.access_token
}
