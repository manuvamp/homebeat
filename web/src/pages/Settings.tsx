import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import {
  ArrowDown,
  ArrowUp,
  BatteryMedium,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  Funnel,
  Gift,
  HeartHandshake,
  Home,
  KeyRound,
  Lock,
  LockOpen,
  Plug,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Users,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import type { Device, Household, Member } from '@shared/types'
import { api, getMode } from '@/lib/api'
import { useApp } from '@/lib/store'
import { DEVICE_ICON } from '@/lib/meta'
import { formatClock, now } from '@/lib/time'
import { joinNames, membersByOrder, possessive, plural, primaryMember } from '@/lib/format'
import { SimulatorPanel } from '@/components/SimulatorPanel'
import { Button, Card, PageHeader, Pill, StatusDot, cx, friendlyError, inputCls } from '@/components/ui'

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'family', label: 'Family', icon: Users },
  { id: 'devices', label: 'Devices', icon: BatteryMedium },
  { id: 'ring', label: 'Ring', icon: Plug },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'subscription', label: 'Plan', icon: Gift },
  { id: 'help', label: 'Help', icon: CircleHelp },
]

function Section({ id, title, icon: Icon, intro, children }: { id: string; title: string; icon: LucideIcon; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary" aria-hidden>
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <h2 id={`${id}-title`} className="font-serif text-[22px] font-medium">
          {title}
        </h2>
      </div>
      {intro && <p className="mb-4 max-w-2xl text-[15px] text-ink-soft">{intro}</p>}
      {children}
    </section>
  )
}

function SavedNote({ show }: { show: boolean }) {
  return (
    <span role="status" className={cx('inline-flex items-center gap-1 text-sm font-medium text-calm transition-opacity', show ? 'opacity-100' : 'opacity-0')}>
      {show && (
        <>
          <Check className="size-4" strokeWidth={2.25} aria-hidden /> Saved
        </>
      )}
    </span>
  )
}

// ---------- Home ----------
function HomeSection({ household, onSaved }: { household: Household; onSaved: (h: Household) => void }) {
  const [name, setName] = useState(household.homeName)
  const [start, setStart] = useState(household.quietHours.start)
  const [end, setEnd] = useState(household.quietHours.end)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const dirty = name !== household.homeName || start !== household.quietHours.start || end !== household.quietHours.end
  async function save() {
    setBusy(true)
    setError('')
    try {
      const h = await api.updateHousehold({ homeName: name.trim() || household.homeName, quietHours: { start, end } })
      onSaved(h)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section id="home" title={household.homeName} icon={Home} intro={`Where ${household.parentName} lives, and the hours when any door activity should reach you right away.`}>
      <Card className="p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="home-name" className="mb-1.5 block text-[15px] font-medium">
              Home name
            </label>
            <input id="home-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="qh-start" className="mb-1.5 block text-[15px] font-medium">
              Quiet hours start
            </label>
            <input id="qh-start" type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="qh-end" className="mb-1.5 block text-[15px] font-medium">
              Quiet hours end
            </label>
            <input id="qh-end" type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <p className="mt-4 rounded-2xl bg-paper px-4 py-3 text-[14px] text-ink-soft">
          Between <strong className="font-semibold text-ink">{formatClock(start)}</strong> and{' '}
          <strong className="font-semibold text-ink">{formatClock(end)}</strong>, anyone at the door is treated as urgent. Times are in {household.parentName}’s timezone (
          {household.timezone.replace('_', ' ')}).
        </p>
        {error && <p className="mt-3 text-sm font-medium text-urgent">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={save} loading={busy} disabled={!dirty}>
            Save changes
          </Button>
          <SavedNote show={saved} />
        </div>
      </Card>
    </Section>
  )
}

// ---------- Family ----------
const ROLE_LABEL: Record<Member['role'], { label: string; cls: string }> = {
  primary: { label: 'Gets every alert', cls: 'bg-primary-soft text-primary' },
  family: { label: 'Family', cls: 'bg-calm-bg text-calm' },
  viewer: { label: 'Can view', cls: 'bg-paper-deep text-ink-soft' },
}

function FamilySection({ household, onSaved }: { household: Household; onSaved: (h: Household) => void }) {
  const [members, setMembers] = useState(() => [...household.members].sort((a, b) => a.escalationOrder - b.escalationOrder))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [announce, setAnnounce] = useState('')

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= members.length) return
    const next = [...members]
    ;[next[i], next[j]] = [next[j], next[i]]
    const ordered = next.map((m, k) => ({ ...m, escalationOrder: k + 1 }))
    setMembers(ordered)
    setAnnounce(`${ordered[j].name} is now number ${j + 1} to be told.`)
    setError('')
    try {
      const h = await api.updateHousehold({ members: ordered })
      onSaved(h)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  const [first, second] = members
  return (
    <Section
      id="family"
      title="Family & who gets told"
      icon={Users}
      intro="When something needs attention, Homebeat tells people in this order. Urgent moments go to the whole family at once."
    >
      <Card className="overflow-hidden">
        <ol className="divide-y divide-line">
          {members.map((m, i) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-paper-deep text-sm font-semibold text-ink-soft tabular" aria-hidden>
                {i + 1}
              </span>
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sage/25 font-serif text-lg font-medium text-primary" aria-hidden>
                {m.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-semibold">{m.name}</p>
                <p className="text-[14px] text-ink-mute">{m.relation}</p>
              </div>
              <span className={cx('hidden rounded-full px-2.5 py-1 text-[12px] font-semibold sm:inline-block', ROLE_LABEL[m.role].cls)}>{ROLE_LABEL[m.role].label}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="grid size-11 place-items-center rounded-full text-ink-soft hover:bg-paper-deep disabled:opacity-30"
                  aria-label={`Move ${m.name} up`}
                >
                  <ArrowUp className="size-5" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === members.length - 1}
                  className="grid size-11 place-items-center rounded-full text-ink-soft hover:bg-paper-deep disabled:opacity-30"
                  aria-label={`Move ${m.name} down`}
                >
                  <ArrowDown className="size-5" strokeWidth={1.75} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper/60 px-5 py-3.5">
          <p className="text-[14px] text-ink-soft">
            {first && second ? `If ${first.name} doesn’t respond in ${plural(household.escalateAfterMin, 'minute')}, ${second.name} is told next.` : 'Add a second person so nothing waits on one phone.'}
          </p>
          <SavedNote show={saved} />
        </div>
      </Card>
      {error && <p className="mt-3 text-sm font-medium text-urgent">{error}</p>}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </Section>
  )
}

// ---------- Devices ----------
function BatteryBar({ value }: { value: number }) {
  const low = value < 25
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-2 w-16 overflow-hidden rounded-full bg-paper-deep" role="img" aria-label={`Battery ${value}%`}>
        <span className={cx('absolute inset-y-0 left-0 rounded-full', low ? 'bg-heads' : 'bg-sage')} style={{ width: `${value}%` }} />
      </span>
      <span className={cx('text-[13px] font-medium tabular', low ? 'text-heads' : 'text-ink-soft')}>{value}%</span>
    </span>
  )
}

function DeviceCard({ d }: { d: Device }) {
  const Icon = DEVICE_ICON[d.kind]
  const kindLabel = d.kind === 'doorbell' ? 'Video doorbell' : d.kind === 'camera' ? 'Camera' : d.kind === 'chime' ? 'Chime' : d.kind === 'sensor' ? 'Sensor' : 'Device'
  const battery = typeof d.battery === 'number'
  const hasVideo = d.kind === 'doorbell' || d.kind === 'camera'
  return (
    <Card as="li" className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-paper-deep text-primary" aria-hidden>
          <Icon className="size-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold">{d.name}</p>
          <p className="text-[14px] text-ink-mute">{kindLabel}</p>
        </div>
        <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold', d.online === false ? 'bg-heads-bg text-heads' : 'bg-calm-bg text-calm')}>
          {d.online === false ? <WifiOff className="size-3.5" strokeWidth={2} aria-hidden /> : <Wifi className="size-3.5" strokeWidth={2} aria-hidden />}
          {d.online === false ? 'Offline' : d.online === null ? 'Unknown' : 'Online'}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
        {hasVideo && (
          <div>
            <dt className="text-ink-mute">Power</dt>
            <dd className="mt-0.5 font-medium">{battery ? <BatteryBar value={d.battery as number} /> : 'Wired'}</dd>
          </div>
        )}
        {hasVideo && d.maxLiveSeconds && (
          <div>
            <dt className="text-ink-mute">Live view</dt>
            <dd className="mt-0.5 font-medium">Up to {d.maxLiveSeconds} s</dd>
          </div>
        )}
        {hasVideo && (
          <div>
            <dt className="text-ink-mute">Motion zones</dt>
            <dd className="mt-0.5 font-medium tabular">{d.motionZones ?? 0}</dd>
          </div>
        )}
        {hasVideo && (
          <div>
            <dt className="text-ink-mute">Privacy zones</dt>
            <dd className="mt-0.5 font-medium tabular">{d.privacyZones ?? 0}</dd>
          </div>
        )}
      </dl>
      {hasVideo && (
        <p className={cx('mt-4 flex gap-2 rounded-2xl px-3.5 py-3 text-[14px]', d.encrypted ? 'bg-note-bg text-note' : 'bg-paper text-ink-soft')}>
          {d.encrypted ? <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden /> : <LockOpen className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />}
          <span>
            {d.encrypted
              ? 'End-to-end encryption is on, so Homebeat can’t see video or snapshots. Moments still work from motion alerts.'
              : 'End-to-end encryption is off, so Homebeat can read snapshots to describe moments.'}
          </span>
        </p>
      )}
      {d.chimeSlots && d.chimeSlots.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[14px] text-ink-mute">Sounds Homebeat can play</p>
          <ul className="space-y-1.5">
            {d.chimeSlots.map((s, i) => (
              <li key={s.event} className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-[14px]">
                <span className="font-medium">
                  Slot {i + 1} · {s.name}
                </span>
                <span className={cx('text-[13px] font-medium', s.disabled ? 'text-ink-mute' : 'text-calm')}>{s.disabled ? 'Turned off' : 'Ready'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function DevicesSection() {
  const { today } = useApp()
  const parent = today.household.parentName
  const [devices, setDevices] = useState(today.devices)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => setDevices(today.devices), [today.devices])
  async function refresh() {
    setBusy(true)
    setMsg('')
    try {
      setDevices(await api.refreshDevices())
      setMsg('Devices are up to date.')
    } catch (e) {
      setMsg(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section id="devices" title="Devices" icon={BatteryMedium} intro={`The Ring devices Homebeat can see at ${possessive(parent)} home.`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" icon={RefreshCw} loading={busy} onClick={refresh}>
          Refresh devices
        </Button>
        <span role="status" className="text-sm text-ink-mute">
          {msg}
        </span>
      </div>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {devices.map((d) => (
          <DeviceCard key={d.id} d={d} />
        ))}
      </ul>
      <Card className="mt-4 flex gap-4 bg-paper-deep/60 p-5">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-primary shadow-sm" aria-hidden>
          <Smartphone className="size-[22px]" strokeWidth={1.75} />
        </span>
        <div>
          <p className="font-semibold">Change motion zones and Smart Alerts in the Ring app</p>
          <p className="mt-1 text-[15px] text-ink-soft">
            Homebeat uses the settings you already have. To stop alerts from the street or a busy path, open the Ring app, choose the device, then go to Motion Settings.
            Changes show up here within a few minutes.
          </p>
        </div>
      </Card>
    </Section>
  )
}

// ---------- Ring connection ----------
const MODE_LABEL: Record<Household['ringMode'], { label: string; cls: string; body: string }> = {
  playground: {
    label: 'Ring Developer Playground',
    cls: 'bg-note-bg text-note',
    body: 'Homebeat is connected to the Ring Developer Playground with a token. Playground tokens last 30 minutes, so paste a fresh one when it runs out.',
  },
  linked: { label: 'Linked', cls: 'bg-calm-bg text-calm', body: 'The Ring account is linked. Homebeat stays connected on its own.' },
  offline_sim: { label: 'Offline simulator', cls: 'bg-paper-deep text-ink-soft', body: 'Homebeat is replaying recorded doorbell activity, not live Ring data.' },
}

function useTicker(ms: number) {
  const [, setT] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setT((x) => x + 1), ms)
    return () => clearInterval(i)
  }, [ms])
}

function formatRemaining(ms: number) {
  if (ms <= 0) return 'Expired'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  return `${m} min ${String(sec).padStart(2, '0')} s`
}

function RingSection({ household, onSaved }: { household: Household; onSaved: (h: Household) => void }) {
  useTicker(1000)
  const mode = getMode()
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const m = MODE_LABEL[household.ringMode]
  const remaining = household.tokenExpiresAt ? household.tokenExpiresAt - now() : null
  const lowTime = remaining !== null && remaining < 5 * 60_000

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const r = await api.setToken(token.trim())
      if (r.ok) {
        setResult({ ok: true, text: `Connected. Homebeat can see ${r.devices.length} device${r.devices.length === 1 ? '' : 's'}.` })
        setToken('')
        try {
          onSaved(await api.household())
        } catch {
          /* ignore */
        }
      } else setResult({ ok: false, text: r.error ?? 'Ring didn’t accept that token. Copy a fresh one and try again.' })
    } catch (err) {
      setResult({ ok: false, text: friendlyError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section id="ring" title="Ring connection" icon={Plug}>
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[14px] font-semibold', m.cls)}>
            <StatusDot tone={household.ringMode === 'offline_sim' ? 'off' : 'ok'} />
            {m.label}
          </span>
          {mode.kind === 'mock' && <Pill>Sample data</Pill>}
        </div>
        <p className="mt-3 max-w-2xl text-[15px] text-ink-soft">{m.body}</p>
        {mode.kind === 'mock' && (
          <p className="mt-2 max-w-2xl text-[14px] text-ink-mute">
            {mode.reason === 'fallback'
              ? `The Homebeat server isn’t reachable, so you’re seeing sample data for ${household.homeName}.`
              : `You’re looking at sample data for ${household.homeName}. Nothing here comes from a real doorbell.`}
          </p>
        )}

        {household.ringMode === 'offline_sim' && mode.kind === 'real' && (
          <div className="mt-5">
            <SimulatorPanel />
          </div>
        )}

        {household.ringMode === 'playground' && remaining !== null && (
          <div className={cx('mt-5 flex items-center gap-4 rounded-2xl px-4 py-3.5', lowTime ? 'bg-heads-bg' : 'bg-paper')}>
            <KeyRound className={cx('size-6 shrink-0', lowTime ? 'text-heads' : 'text-primary')} strokeWidth={1.75} aria-hidden />
            <div>
              <p className="text-[14px] text-ink-mute">Token expires in</p>
              <p className={cx('font-serif text-[24px] leading-tight tabular', lowTime ? 'text-heads' : 'text-ink')} aria-live="off">
                {formatRemaining(remaining)}
              </p>
            </div>
          </div>
        )}

        {household.ringMode === 'playground' && (
          <div className="mt-5 rounded-2xl bg-paper px-4 py-3.5">
            <p className="text-[15px] font-semibold">Try it from the Playground</p>
            <p className="mt-1 max-w-2xl text-[15px] text-ink-soft">
              In the Ring Developer Playground, under “Simulate live view event”, choose Package, Vehicle or Motion. When the clip ends (20 to 40 seconds), Homebeat reads the
              event from Ring’s Event History, looks at frames through the image API and shows what it decided on Today. Each moment shows how Homebeat looked at it, step by step.
            </p>
          </div>
        )}

        {household.ringMode !== 'linked' && (
          <form onSubmit={submit} className="mt-5">
            <label htmlFor="ring-token" className="mb-1.5 block text-[15px] font-medium">
              Paste a new token
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <input
                  id="ring-token"
                  type={show ? 'text' : 'password'}
                  className={cx(inputCls, 'pr-14 font-mono text-[14px]')}
                  placeholder="eyJhbGciOi…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="ring-token-hint"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute top-1/2 right-1.5 grid size-10 -translate-y-1/2 place-items-center rounded-full text-ink-mute hover:bg-paper-deep"
                  aria-label={show ? 'Hide token' : 'Show token'}
                  aria-pressed={show}
                >
                  {show ? <EyeOff className="size-[18px]" strokeWidth={1.75} /> : <Eye className="size-[18px]" strokeWidth={1.75} />}
                </button>
              </div>
              <Button type="submit" loading={busy} disabled={!token.trim()}>
                Connect
              </Button>
            </div>
            <p id="ring-token-hint" className="mt-1.5 text-sm text-ink-mute">
              Copy it from the Ring Developer Playground. Homebeat keeps it on the server and never shows it again.
            </p>
            {result && (
              <p role="status" className={cx('mt-3 flex items-start gap-2 rounded-2xl px-4 py-3 text-[14px] font-medium', result.ok ? 'bg-calm-bg text-calm' : 'bg-urgent-bg text-urgent')}>
                {result.ok && <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} aria-hidden />}
                {result.text}
              </p>
            )}
          </form>
        )}
      </Card>
    </Section>
  )
}

// ---------- Privacy ----------
function PrivacySection({ household }: { household: Household }) {
  const parent = household.parentName
  const primary = primaryMember(household)
  const consent = household.consent
  const items: { title: string; body: string }[] = [
    { title: 'No face recognition, ever', body: 'Homebeat describes what’s happening (“a care worker with a bag”), never who someone is.' },
    { title: 'Snapshots only for moments', body: 'A still image is kept only when it becomes a moment you can see, and deleted after 30 days.' },
    { title: 'Motion is counted, not kept', body: 'The dozens of everyday motion alerts are reduced to a daily count. Their details aren’t stored.' },
    { title: 'Only your family sees it', body: `Moments go to ${joinNames(membersByOrder(household).map((m) => m.name)) || 'the family members above'} as set above. Care reports are shared only when you choose to.` },
  ]
  return (
    <Section id="privacy" title="Privacy & consent" icon={ShieldCheck}>
      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-calm-bg px-4 py-3.5 text-calm">
          <HeartHandshake className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          <p className="text-[15px]">
            {consent ? (
              <>
                <strong className="font-semibold">
                  {consent.by} agreed on {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: household.timezone }).format(consent.at)}.
                </strong>{' '}
                {consent.note || `${parent} can pause Homebeat any time${primary ? ` by asking ${primary.name}` : ''}.`}
              </>
            ) : (
              <>
                <strong className="font-semibold">{parent}’s agreement hasn’t been recorded yet.</strong> Talk it through together before relying on Homebeat; {parent} can pause it any time.
              </>
            )}
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((it) => (
            <li key={it.title} className="flex gap-3">
              <Check className="mt-1 size-[18px] shrink-0 text-calm" strokeWidth={2.25} aria-hidden />
              <div>
                <p className="font-semibold">{it.title}</p>
                <p className="mt-0.5 text-[15px] text-ink-soft">{it.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  )
}

// ---------- Subscription ----------
function SubscriptionSection({ household }: { household: Household }) {
  const plan = household.plan
  if (!plan) return null
  const total = plan.trialDays ?? 30
  const left = plan.trialEndsAt ? Math.max(0, Math.ceil((plan.trialEndsAt - now()) / 86_400_000)) : null
  const used = left === null ? null : Math.min(total, Math.max(0, total - left))
  return (
    <Section id="subscription" title="Your plan" icon={Gift}>
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="flex-1">
          <p className="text-[14px] font-medium text-ink-mute">{plan.name}</p>
          <p className="mt-0.5 font-serif text-[24px]">
            {left === null ? 'Active' : left === 0 ? 'Free trial ended' : `Free trial — ${plural(left, 'day')} left`}
          </p>
          <p className="mt-1 text-[15px] text-ink-soft">Everything included for one home and up to five family members. Nothing to pay today.</p>
        </div>
        {used !== null && (
          <div className="w-full sm:w-48">
            <div className="h-2 overflow-hidden rounded-full bg-paper-deep" role="img" aria-label={`${used} of ${total} trial days used`}>
              <div className="h-full rounded-full bg-sage" style={{ width: `${(used / total) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-[13px] text-ink-mute tabular">
              {used} of {plural(total, 'day')} used
            </p>
          </div>
        )}
      </Card>
    </Section>
  )
}

// ---------- Help ----------
function HelpSection() {
  const links = [
    { to: '/welcome?tour=1', label: 'Replay the quick tour', body: 'Three short steps on how Homebeat works.', icon: CircleHelp },
    { to: '/how', label: 'How Homebeat watches', body: 'What happens between a doorbell alert and a moment.', icon: Funnel },
  ]
  return (
    <Section id="help" title="Help" icon={CircleHelp}>
      <Card as="div" className="overflow-hidden">
        <ul className="divide-y divide-line">
          {links.map((l) => (
            <li key={l.to}>
              <Link to={l.to} className="flex min-h-16 items-center gap-3 px-5 py-3 hover:bg-paper">
                <l.icon className="size-[22px] shrink-0 text-primary" strokeWidth={1.75} aria-hidden />
                <span className="flex-1">
                  <span className="block font-semibold">{l.label}</span>
                  <span className="block text-[14px] text-ink-mute">{l.body}</span>
                </span>
                <ChevronRight className="size-5 text-ink-mute" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  )
}

export default function SettingsPage() {
  const { today, refresh } = useApp()
  const [household, setHousehold] = useState(today.household)
  const loc = useLocation()
  useEffect(() => setHousehold(today.household), [today.household])
  useEffect(() => {
    if (!loc.hash) return
    const el = document.getElementById(loc.hash.slice(1))
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }))
  }, [loc.hash])
  const onSaved = (h: Household) => {
    setHousehold(h)
    void refresh().catch(() => {})
  }
  return (
    <div>
      <PageHeader title="Settings" subtitle={`Everything about ${household.homeName}, who gets told, and how Homebeat connects to Ring.`} />
      <nav aria-label="Settings sections" className="no-print -mx-4 mb-8 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
        <ul className="flex gap-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-[14px] font-medium whitespace-nowrap text-ink-soft ring-1 ring-line hover:text-primary hover:ring-primary/40">
                <s.icon className="size-4" strokeWidth={1.75} aria-hidden />
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-12">
        <HomeSection household={household} onSaved={onSaved} />
        <FamilySection household={household} onSaved={onSaved} />
        <DevicesSection />
        <RingSection household={household} onSaved={onSaved} />
        <PrivacySection household={household} />
        <SubscriptionSection household={household} />
        <HelpSection />
      </div>
    </div>
  )
}

