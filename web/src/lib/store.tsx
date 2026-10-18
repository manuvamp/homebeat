import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Device, Moment, StreamMessage, TodaySummary } from '@shared/types'
import { api, getMode, type ApiMode, type StreamState } from './api'
import { dateKey, setHouseholdTz, todayKey } from './time'

export interface Toast {
  id: string
  tone: 'calm' | 'note' | 'heads_up' | 'urgent'
  title: string
  body?: string
  href?: string
}

interface AppState {
  today: TodaySummary
  mode: ApiMode
  stream: StreamState
  /** ids of moments that arrived live during this session (for the arrival animation) */
  fresh: Set<string>
  toasts: Toast[]
  pushToast(t: Omit<Toast, 'id'>): void
  dismissToast(id: string): void
  refresh(): Promise<void>
  /** Merge a moment returned by an action (ack, feedback) into state. */
  upsertMoment(m: Moment): void
  /** Lookup by id across today + anything fetched for history. */
  rememberMoments(ms: Moment[]): void
  momentById(id: string): Moment | undefined
  announce(text: string, urgent?: boolean): void
}

const Ctx = createContext<AppState | null>(null)

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

export function AppProvider({ initial, children }: { initial: TodaySummary; children: ReactNode }) {
  const [today, setToday] = useState(initial)
  const [stream, setStream] = useState<StreamState>('connecting')
  const [fresh, setFresh] = useState<Set<string>>(() => new Set())
  const [toasts, setToasts] = useState<Toast[]>([])
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  const cache = useRef(new Map<string, Moment>())
  const [, bump] = useState(0)

  useEffect(() => {
    setHouseholdTz(today.household.timezone)
  }, [today.household.timezone])

  const remember = useCallback((ms: Moment[]) => {
    for (const m of ms) cache.current.set(m.id, m)
    bump((x) => x + 1)
  }, [])
  useEffect(() => remember(initial.moments), [initial, remember])

  const announce = useCallback((text: string, urgent = false) => {
    const set = urgent ? setAssertive : setPolite
    set('')
    requestAnimationFrame(() => set(text))
  }, [])

  const dismissToast = useCallback((id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const pushToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((ts) => [{ ...t, id }, ...ts].slice(0, 3))
      setTimeout(() => dismissToast(id), t.tone === 'urgent' ? 12000 : 6500)
    },
    [dismissToast],
  )

  const upsertMoment = useCallback(
    (m: Moment) => {
      remember([m])
      setToday((t) => {
        const exists = t.moments.some((x) => x.id === m.id)
        // Moments from other days are only cached (for detail pages), not added to Today.
        if (!exists && dateKey(m.at) !== todayKey()) return t
        const moments = exists ? t.moments.map((x) => (x.id === m.id ? m : x)) : [m, ...t.moments].sort((a, b) => b.at - a.at)
        return { ...t, moments, counts: exists ? t.counts : { ...t.counts, moments: t.counts.moments + 1 } }
      })
    },
    [remember],
  )

  const refresh = useCallback(async () => {
    const t = await api.today()
    remember(t.moments)
    setToday(t)
  }, [remember])

  // Live stream
  const handlerRef = useRef<(m: StreamMessage) => void>(() => {})
  handlerRef.current = (msg: StreamMessage) => {
    switch (msg.type) {
      case 'moment': {
        const m = msg.moment
        upsertMoment(m)
        setToday((t) => ({ ...t, counts: { ...t.counts, rawEvents: t.counts.rawEvents + 1 }, lastSeenAt: m.at }))
        if (m.severity === 'urgent' || m.severity === 'heads_up') {
          setFresh((f) => new Set(f).add(m.id))
          pushToast({ tone: m.severity, title: m.title, body: m.body, href: `/moment/${m.id}` })
          announce(`${m.severity === 'urgent' ? 'Urgent: ' : 'Heads up: '}${m.title}. ${m.body}`, m.severity === 'urgent')
        } else {
          setFresh((f) => new Set(f).add(m.id))
          announce(`New moment: ${m.title}`)
        }
        break
      }
      case 'moment_updated':
        upsertMoment(msg.moment)
        break
      case 'visit':
        setToday((t) => {
          const v = msg.visit
          const visitsToday = t.visitsToday.some((x) => x.id === v.id)
            ? t.visitsToday.map((x) => (x.id === v.id ? v : x))
            : v.date === t.visitsToday[0]?.date
              ? [...t.visitsToday, v]
              : t.visitsToday
          const nextVisit = t.nextVisit?.id === v.id ? (v.status === 'upcoming' || v.status === 'due' ? v : undefined) : t.nextVisit
          return { ...t, visitsToday, nextVisit }
        })
        break
      case 'device':
        setToday((t) => ({ ...t, devices: upsertDevice(t.devices, msg.device) }))
        break
      case 'status':
        setToday((t) => ({ ...t, status: msg.status }))
        break
      case 'ring':
        setToday((t) => ({ ...t, household: { ...t.household, ringMode: msg.mode, tokenExpiresAt: msg.tokenExpiresAt ?? t.household.tokenExpiresAt } }))
        if (msg.error) pushToast({ tone: 'heads_up', title: 'Ring connection needs attention', body: msg.error, href: '/settings#ring' })
        break
      case 'event':
        setToday((t) => ({ ...t, counts: { ...t.counts, rawEvents: t.counts.rawEvents + 1 } }))
        break
      default:
        break
    }
  }
  useEffect(() => api.subscribe((m) => handlerRef.current(m), setStream), [])

  const value = useMemo<AppState>(
    () => ({
      today,
      mode: getMode(),
      stream,
      fresh,
      toasts,
      pushToast,
      dismissToast,
      refresh,
      upsertMoment,
      rememberMoments: remember,
      momentById: (id) => cache.current.get(id) ?? today.moments.find((m) => m.id === id),
      announce,
    }),
    [today, stream, fresh, toasts, pushToast, dismissToast, refresh, upsertMoment, remember, announce],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </Ctx.Provider>
  )
}

function upsertDevice(list: Device[], d: Device) {
  return list.some((x) => x.id === d.id) ? list.map((x) => (x.id === d.id ? d : x)) : [...list, d]
}

/** Small data-fetching hook with loading/error and a reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    setState((s) => ({ data: s.data, loading: true }))
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (error: Error) => alive && setState({ error, loading: false }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  return { ...state, reload: () => setNonce((n) => n + 1), setData: (data: T) => setState({ data, loading: false }) }
}
