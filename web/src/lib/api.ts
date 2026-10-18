import type {
  Analysis,
  CompiledRule,
  DailyDigest,
  Device,
  FunnelStats,
  Household,
  LiveSessionResponse,
  Moment,
  Rule,
  Schedule,
  StreamMessage,
  TodaySummary,
  Visit,
  WeeklyReport,
} from '@shared/types'

export interface SetupStatus {
  mode: Household['ringMode']
  tokenExpiresAt?: number
  accountLinked: boolean
  devices: Device[]
}

/** Everything the web app needs from the backend. Implemented by the real HTTP client and by the mock. */
export interface HomebeatApi {
  today(): Promise<TodaySummary>
  moments(date: string): Promise<Moment[]>
  ack(id: string, by: string): Promise<Moment>
  feedback(id: string, feedback: 'right' | 'wrong'): Promise<Moment>
  chime(id: string): Promise<{ ok: boolean; slot?: string; error?: string }>
  visits(from: string, to: string): Promise<Visit[]>
  schedules(): Promise<Schedule[]>
  createSchedule(s: Omit<Schedule, 'id'>): Promise<Schedule>
  updateSchedule(s: Schedule): Promise<Schedule>
  deleteSchedule(id: string): Promise<{ ok: true }>
  rules(): Promise<Rule[]>
  compileRule(english: string): Promise<CompiledRule>
  createRule(english: string, compiled: CompiledRule): Promise<Rule>
  setRuleEnabled(id: string, enabled: boolean): Promise<Rule>
  deleteRule(id: string): Promise<{ ok: true }>
  devices(): Promise<Device[]>
  refreshDevices(): Promise<Device[]>
  startLive(deviceId: string, sdp: string): Promise<LiveSessionResponse>
  stopLive(sessionId: string): Promise<{ ok: true }>
  analysis(id: string): Promise<Analysis>
  funnel(days?: number): Promise<FunnelStats>
  digest(date: string): Promise<DailyDigest>
  report(weekOf: string): Promise<WeeklyReport>
  household(): Promise<Household>
  updateHousehold(patch: Partial<Household>): Promise<Household>
  setupStatus(): Promise<SetupStatus>
  setToken(token: string): Promise<{ ok: boolean; devices: Device[]; error?: string }>
  checkin(code: string): Promise<{ ok: boolean; who?: string }>
  /** Who a check-in link belongs to (404 when the link is unknown). */
  checkinInfo(code: string): Promise<{ who: string; parentName: string }>
  /** Offline simulator only (ringMode 'offline_sim'): fire a pretend Ring event. 409 in other modes. */
  simEvent(action: SimAction): Promise<{ ok: boolean }>
  /** Subscribe to live updates. Returns an unsubscribe function. */
  subscribe(onMessage: (m: StreamMessage) => void, onState?: (s: StreamState) => void): () => void
}

export type SimAction =
  | 'aide_arrives'
  | 'aide_leaves'
  | 'delivery'
  | 'package_collected'
  | 'meals'
  | 'resident_out'
  | 'night_visitor'
  | 'car_arrives'
  | 'doorbell'

export type StreamState = 'connecting' | 'open' | 'reconnecting'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok) {
    let msg = res.statusText
    if (type.includes('json')) {
      try {
        const j = (await res.json()) as { error?: string; message?: string }
        msg = j.error ?? j.message ?? msg
      } catch {
        /* ignore */
      }
    }
    throw new ApiError(res.status, msg)
  }
  if (!type.includes('json')) throw new ApiError(502, 'The Homebeat server sent an unexpected reply.')
  return (await res.json()) as T
}

const q = (params: Record<string, string | number>) =>
  '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
const enc = encodeURIComponent

export const realApi: HomebeatApi = {
  today: () => http('GET', '/api/today'),
  moments: (date) => http('GET', '/api/moments' + q({ date })),
  ack: (id, by) => http('POST', `/api/moments/${enc(id)}/ack`, { by }),
  feedback: (id, feedback) => http('POST', `/api/moments/${enc(id)}/feedback`, { feedback }),
  chime: (id) => http('POST', `/api/moments/${enc(id)}/chime`, {}),
  visits: (from, to) => http('GET', '/api/visits' + q({ from, to })),
  schedules: () => http('GET', '/api/schedules'),
  createSchedule: (s) => http('POST', '/api/schedules', s),
  updateSchedule: (s) => http('PUT', `/api/schedules/${enc(s.id)}`, s),
  deleteSchedule: (id) => http('DELETE', `/api/schedules/${enc(id)}`),
  rules: () => http('GET', '/api/rules'),
  compileRule: (english) => http('POST', '/api/rules/compile', { english }),
  createRule: (english, compiled) => http('POST', '/api/rules', { english, compiled }),
  setRuleEnabled: (id, enabled) => http('PATCH', `/api/rules/${enc(id)}`, { enabled }),
  deleteRule: (id) => http('DELETE', `/api/rules/${enc(id)}`),
  devices: () => http('GET', '/api/devices'),
  refreshDevices: () => http('POST', '/api/devices/refresh', {}),
  startLive: (deviceId, sdp) => http('POST', `/api/live/${enc(deviceId)}`, { sdp }),
  stopLive: (sessionId) => http('DELETE', `/api/live/${enc(sessionId)}`),
  analysis: (id) => http('GET', `/api/analysis/${enc(id)}`),
  funnel: (days = 30) => http('GET', '/api/funnel' + q({ days })),
  digest: (date) => http('GET', '/api/digest' + q({ date })),
  report: (weekOf) => http('GET', '/api/report' + q({ weekOf })),
  household: () => http('GET', '/api/household'),
  updateHousehold: (patch) => http('PUT', '/api/household', patch),
  setupStatus: () => http('GET', '/api/setup/status'),
  setToken: (token) => http('POST', '/api/setup/token', { token }),
  checkin: (code) => http('POST', '/api/checkin', { code }),
  checkinInfo: (code) => http('GET', `/api/checkin/${enc(code)}`),
  simEvent: (action) => http('POST', '/api/sim/event', { action }),
  subscribe(onMessage, onState) {
    let es: EventSource | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const open = () => {
      onState?.(attempt === 0 ? 'connecting' : 'reconnecting')
      es = new EventSource('/api/stream')
      es.onopen = () => {
        attempt = 0
        onState?.('open')
      }
      es.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data as string) as StreamMessage)
        } catch {
          /* ignore malformed frames */
        }
      }
      es.onerror = () => {
        es?.close()
        if (closed) return
        attempt++
        onState?.('reconnecting')
        retry = setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)))
      }
    }
    open()
    return () => {
      closed = true
      clearTimeout(retry)
      es?.close()
    }
  },
}

// ---- Mode switching: real backend, or the bundled mock (VITE_MOCK=1, or automatic when /api/today fails) ----

export type ApiMode = { kind: 'real' } | { kind: 'mock'; reason: 'env' | 'fallback' }

const forcedMock = import.meta.env.VITE_MOCK === '1' || import.meta.env.VITE_MOCK === 'true'
let mode: ApiMode = forcedMock ? { kind: 'mock', reason: 'env' } : { kind: 'real' }
let mockApi: HomebeatApi | null = null

async function loadMock() {
  if (!mockApi) mockApi = (await import('@/mock/api')).createMockApi()
  return mockApi
}

export function getMode() {
  return mode
}
export function isMock() {
  return mode.kind === 'mock'
}

async function active(): Promise<HomebeatApi> {
  return mode.kind === 'mock' ? loadMock() : realApi
}

/**
 * Boot: decides once whether the real backend is reachable. Called before the first render.
 * Any failure of /api/today (network, 5xx, HTML from a static host) falls back to sample data.
 */
export async function boot(): Promise<TodaySummary> {
  if (mode.kind === 'real') {
    try {
      return await realApi.today()
    } catch {
      mode = { kind: 'mock', reason: 'fallback' }
    }
  }
  return (await loadMock()).today()
}

/** Client used across the app. Methods forward to whichever implementation is active. */
export const api: HomebeatApi = new Proxy({} as HomebeatApi, {
  get(_t, key: string) {
    if (key === 'subscribe') {
      return (onMessage: (m: StreamMessage) => void, onState?: (s: StreamState) => void) => {
        if (mode.kind === 'real') return realApi.subscribe(onMessage, onState)
        let unsub: (() => void) | null = null
        let cancelled = false
        void loadMock().then((m) => {
          if (!cancelled) unsub = m.subscribe(onMessage, onState)
        })
        return () => {
          cancelled = true
          unsub?.()
        }
      }
    }
    return async (...args: unknown[]) => {
      const impl = await active()
      const fn = impl[key as keyof HomebeatApi] as unknown as (...a: unknown[]) => Promise<unknown>
      return fn.apply(impl, args)
    }
  },
})

/** Dev helper for the mock: pushes a simulated moment through the stream. */
export async function simulateEvent(kind?: 'urgent' | 'heads_up' | 'calm') {
  const m = await import('@/mock/api')
  m.simulate(kind)
}
