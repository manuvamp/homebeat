// Ring Partner API client (https://api.amazonvision.com). Server-to-server only: Ring blocks browser CORS.
// Follows the Partner API docs: JSON:API resources, Bearer auth, 429 + Retry-After backoff,
// two-step media downloads (POST -> 303 Location -> GET), WHEP sessions with a Location URL.
import { config } from '../config.ts'
import { getAccessToken, RingAuthError } from './auth.ts'

export class RingApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
  }
}

export interface JsonApiResource<A = Record<string, unknown>> {
  type: string
  id: string
  attributes: A
  relationships?: Record<string, { data?: { type: string; id: string } | null; links?: Record<string, string> }>
}

export interface DeviceBundle {
  device: JsonApiResource<{ name?: string; image_url?: string }>
  status?: JsonApiResource<Record<string, unknown>>
  capabilities?: JsonApiResource<Record<string, unknown>>
  configurations?: JsonApiResource<Record<string, unknown>>
  location?: JsonApiResource<Record<string, unknown>>
}

export interface HistoryEvent {
  id: string
  eventType: string // motion | ding | on_demand
  subType?: string // from composite filters, when the API carries it
  start: number
  end?: number
  deviceId: string
  reviewed: boolean
}

export interface MediaResult {
  bytes: Buffer
  contentType: string
  mediaTimestamp?: number
  origin?: string
}

export type SnapshotRequest =
  | { type: 'at_timestamp'; timestamp: number; width?: number; height?: number }
  | { type: 'latest_in_range'; start: number; end?: number; width?: number; height?: number }

export interface RingApi {
  readonly kind: 'ring' | 'sim'
  listDevices(): Promise<DeviceBundle[]>
  getHistory(deviceId: string, eventTypes?: string[]): Promise<HistoryEvent[]>
  snapshot(deviceId: string, req: SnapshotRequest, componentId?: string): Promise<MediaResult>
  clip(deviceId: string, timestamp: number, durationMs: number): Promise<MediaResult>
  whepOffer(deviceId: string, sdp: string): Promise<{ answer: string; location: string }>
  whepClose(location: string): Promise<void>
  playChime(deviceId: string, audioRef: string): Promise<void>
  usersMe(token?: string): Promise<{ accountId: string; email?: string; name?: string }>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Every Ring call goes through here so the friction log can count retries and status codes.
export const apiLog: { at: number; method: string; path: string; status: number; ms: number }[] = []

async function ringFetch(path: string, init: RequestInit & { token?: string; accept?: string } = {}, attempt = 0): Promise<Response> {
  const token = init.token ?? (await getAccessToken())
  const url = path.startsWith('http') ? path : `${config.ring.apiBase}${path}`
  const started = Date.now()
  const res = await fetch(url, {
    ...init,
    redirect: init.redirect ?? 'follow',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: init.accept ?? 'application/json',
      ...(init.headers as Record<string, string>),
    },
  })
  apiLog.push({ at: started, method: init.method ?? 'GET', path: url.replace(config.ring.apiBase, ''), status: res.status, ms: Date.now() - started })
  if (apiLog.length > 500) apiLog.splice(0, apiLog.length - 500)

  if (res.status === 429 && attempt < 3) {
    // Respect Retry-After; otherwise exponential backoff starting at 1 s (per the API reference).
    const retryAfter = Number(res.headers.get('Retry-After'))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
    return ringFetch(path, init, attempt + 1)
  }
  if (res.status === 401) throw new RingAuthError('Ring token expired or invalid')
  return res
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const detail = body?.errors?.[0]?.detail ?? body?.errors?.[0]?.title ?? text.slice(0, 200)
    throw new RingApiError(res.status, `Ring API ${res.status}: ${detail}`, body)
  }
  return body as T
}

async function media(res: Response): Promise<MediaResult> {
  if (!res.ok) {
    const text = await res.text()
    throw new RingApiError(res.status, `Ring media ${res.status}: ${text.slice(0, 200)}`)
  }
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
    mediaTimestamp: Number(res.headers.get('X-Media-Timestamp')) || undefined,
    origin: res.headers.get('X-Media-Origin') ?? undefined,
  }
}

// Media endpoints answer 303 with a pre-signed Location. The pre-signed URL must be fetched
// WITHOUT our Bearer header (it carries its own security token), so we follow it by hand.
async function download(path: string, body: unknown): Promise<MediaResult> {
  const res = await ringFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
    accept: '*/*',
  })
  if (res.status === 303 || res.status === 302 || res.status === 307) {
    const location = res.headers.get('Location')
    if (!location) throw new RingApiError(res.status, 'Ring media redirect without Location')
    return media(await fetch(location))
  }
  return media(res)
}

export const ringApi: RingApi = {
  kind: 'ring',

  async listDevices() {
    const body = await json<{ data: JsonApiResource[]; included?: JsonApiResource[] }>(
      await ringFetch('/v1/devices?include=status,capabilities,configurations,location'),
    )
    const included = new Map((body.included ?? []).map((r) => [`${r.type}:${r.id}`, r]))
    return body.data.map((device) => {
      const rel = (name: string) => {
        const ref = device.relationships?.[name]?.data
        return ref ? included.get(`${ref.type}:${ref.id}`) : undefined
      }
      return {
        device: device as DeviceBundle['device'],
        status: rel('status'),
        capabilities: rel('capabilities'),
        configurations: rel('configurations'),
        location: rel('location'),
      }
    })
  },

  async getHistory(deviceId, eventTypes) {
    const query = eventTypes?.length ? `?event_types=${encodeURIComponent(eventTypes.join(','))}` : ''
    const body = await json<{ data: JsonApiResource<Record<string, unknown>>[] }>(
      await ringFetch(`/v1/history/devices/${encodeURIComponent(deviceId)}/events${query}`),
    )
    return body.data.map((e) => ({
      id: e.id,
      eventType: String(e.attributes.event_type ?? 'motion'),
      subType: (e.attributes.sub_type as string | undefined) ?? undefined,
      start: Number(e.attributes.start),
      end: e.attributes.end ? Number(e.attributes.end) : undefined,
      deviceId: (e.relationships?.source?.data?.id as string) ?? deviceId,
      reviewed: Boolean(e.attributes.is_third_party_reviewed),
    }))
  },

  snapshot(deviceId, req, componentId) {
    const image_options = { format: 'jpeg', ...(req.width ? { resolution: { width: req.width, height: req.height ?? Math.round((req.width * 9) / 16) } } : {}) }
    const body =
      req.type === 'at_timestamp'
        ? { type: 'at_timestamp', timestamp: req.timestamp, image_options }
        : { type: 'latest_in_range', start_timestamp: req.start, ...(req.end ? { end_timestamp: req.end } : {}), image_options }
    return download(`/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
      ...body,
      ...(componentId ? { components: [{ component_id: componentId }] } : {}),
    })
  },

  clip(deviceId, timestamp, durationMs) {
    return download(`/v1/devices/${encodeURIComponent(deviceId)}/media/video/download`, {
      timestamp,
      duration: Math.min(durationMs, 900_000),
      video_options: { codec: 'avc' },
    })
  },

  async whepOffer(deviceId, sdp) {
    const res = await ringFetch(`/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: sdp,
      accept: 'application/sdp',
    })
    const answer = await res.text()
    if (!res.ok) throw new RingApiError(res.status, `WHEP ${res.status}: ${answer.slice(0, 200)}`)
    const location = res.headers.get('Location') ?? ''
    return { answer, location: location.startsWith('http') ? location : `${config.ring.apiBase}${location}` }
  },

  async whepClose(location) {
    await ringFetch(location, { method: 'DELETE' }).catch(() => undefined)
  },

  async playChime(deviceId, audioRef) {
    await json(
      await ringFetch(`/v1/devices/${encodeURIComponent(deviceId)}/media/audio/playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'audio', attributes: { audio_ref: audioRef } } }),
      }),
    )
  },

  async usersMe(token) {
    const body = await json<{ data: JsonApiResource<Record<string, string>> }>(await ringFetch('/v1/users/me', { token }))
    return {
      accountId: body.data.id,
      email: body.data.attributes?.email,
      name: [body.data.attributes?.first_name, body.data.attributes?.last_name].filter(Boolean).join(' ') || body.data.attributes?.name,
    }
  },
}

// App-Integrations API, used once per account during one-way account linking.
export async function appIntegrations(token: string, method: 'POST' | 'PATCH', body: unknown) {
  return json(
    await ringFetch('/v1/accounts/me/app-integrations', {
      token,
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}
