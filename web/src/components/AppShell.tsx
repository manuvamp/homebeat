import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import {
  CalendarCheck,
  Ellipsis,
  FileText,
  Home,
  ListChecks,
  Settings,
  Video,
  Zap,
  Funnel,
  X,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { useApp } from '@/lib/store'
import { simulateEvent } from '@/lib/api'
import { SEVERITY } from '@/lib/meta'
import { Logo, LogoMark } from './Logo'
import { PageSkeleton } from './PageSkeleton'
import { StatusDot, cx } from './ui'

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean }
const PRIMARY: NavItem[] = [
  { to: '/', label: 'Today', icon: Home, end: true },
  { to: '/visits', label: 'Visits', icon: CalendarCheck },
  { to: '/live', label: 'Live', icon: Video },
  { to: '/rules', label: 'Care rules', icon: ListChecks },
]
const SECONDARY: NavItem[] = [
  { to: '/report', label: 'Care report', icon: FileText },
  { to: '/how', label: 'How Homebeat watches', icon: Funnel },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function ConnectionStatus({ compact }: { compact?: boolean }) {
  const { stream, mode, today } = useApp()
  const devicesOffline = today.devices.filter((d) => d.online === false).length
  let tone: 'ok' | 'warn' | 'off' = 'ok'
  let label = 'Connected to Ring'
  if (mode.kind === 'mock') {
    tone = 'ok'
    label = 'Sample data'
  } else if (stream !== 'open') {
    tone = stream === 'connecting' ? 'ok' : 'warn'
    label = stream === 'connecting' ? 'Connecting…' : 'Reconnecting…'
  } else if (today.household.ringMode === 'playground' && (today.household.tokenExpiresAt ?? Infinity) < Date.now()) {
    // Playground tokens last 30 minutes; after that nothing new arrives until the family pastes a fresh one.
    tone = 'warn'
    label = 'Playground token expired'
  } else if (devicesOffline) {
    tone = 'warn'
    label = `${devicesOffline} device${devicesOffline > 1 ? 's' : ''} offline`
  } else if (today.household.ringMode === 'offline_sim') {
    tone = 'off'
    label = 'Offline simulator'
  }
  return (
    <Link
      to="/settings#ring"
      className={cx('inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-ink-soft hover:bg-paper-deep', compact && 'px-2')}
      aria-label={`Connection: ${label}. Open Ring connection settings.`}
    >
      <StatusDot tone={tone} pulse={tone === 'ok' && mode.kind !== 'mock'} />
      <span className={cx(compact && 'sr-only sm:not-sr-only')}>{label}</span>
    </Link>
  )
}

function SimulateButton() {
  const { mode } = useApp()
  const [busy, setBusy] = useState(false)
  if (mode.kind !== 'mock') return null
  return (
    <button
      type="button"
      onClick={async () => {
        setBusy(true)
        await simulateEvent()
        setTimeout(() => setBusy(false), 600)
      }}
      className="no-print inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 text-[13px] font-medium text-ink-soft hover:border-primary hover:text-primary"
      title="Demo only: push a pretend doorbell event through the live stream"
    >
      <Zap className={cx('size-4', busy && 'animate-pulse')} strokeWidth={1.75} aria-hidden />
      <span className="hidden sm:inline">Simulate event</span>
      <span className="sm:hidden">Simulate</span>
    </button>
  )
}

function Rail() {
  const { today } = useApp()
  const sev = today.status.severity
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-line bg-paper px-4 py-6 lg:flex" aria-label="Main">
      <Link to="/" className="mb-8 px-3" aria-label="Homebeat, go to Today">
        <Logo />
      </Link>
      <nav aria-label="Main navigation">
        <ul className="space-y-1">
          {[...PRIMARY, ...SECONDARY].map((item, i) => (
            <li key={item.to} className={cx(i === PRIMARY.length && 'mt-6 border-t border-line pt-6')}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'group flex min-h-12 items-center gap-3 rounded-2xl px-3 text-[15px] font-medium transition-colors',
                    isActive ? 'bg-primary-soft text-primary' : 'text-ink-soft hover:bg-paper-deep hover:text-ink',
                  )
                }
              >
                <item.icon className="size-[22px]" strokeWidth={1.75} aria-hidden />
                <span className="flex-1">{item.label}</span>
                {item.to === '/' && sev !== 'calm' && (
                  <span className={cx('size-2.5 rounded-full', SEVERITY[sev].dot)} aria-label={SEVERITY[sev].label} />
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto rounded-2xl bg-paper-deep p-4">
        <p className="text-[13px] text-ink-mute">Looking after</p>
        <p className="font-serif text-lg">{today.household.homeName}</p>
        <p className="mt-1 text-[13px] text-ink-mute">
          {today.household.members.filter((m) => m.role !== 'viewer').map((m) => m.name).join(' & ')} get alerts
        </p>
      </div>
    </aside>
  )
}

function TabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const loc = useLocation()
  const moreActive = SECONDARY.some((s) => loc.pathname.startsWith(s.to)) || loc.pathname === '/more'
  const tabs = [...PRIMARY.slice(0, 3), { ...PRIMARY[3], label: 'Rules' }]
  return (
    <nav
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      aria-label="Main navigation"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cx('flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px] font-medium', isActive ? 'text-primary' : 'text-ink-mute')
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cx('grid h-8 w-14 place-items-center rounded-full transition-colors', isActive && 'bg-primary-soft')}>
                    <t.icon className="size-[22px]" strokeWidth={isActive ? 2 : 1.75} aria-hidden />
                  </span>
                  {t.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onMore}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={cx('flex min-h-[60px] w-full flex-col items-center justify-center gap-1 text-[12px] font-medium', moreActive || moreOpen ? 'text-primary' : 'text-ink-mute')}
          >
            <span className={cx('grid h-8 w-14 place-items-center rounded-full', (moreActive || moreOpen) && 'bg-primary-soft')}>
              <Ellipsis className="size-[22px]" strokeWidth={1.75} aria-hidden />
            </span>
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loc = useLocation()
  useEffect(() => {
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
      <div className="absolute inset-0 animate-fade-in bg-ink/30" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 animate-sheet-up rounded-t-[28px] bg-paper px-4 pt-3 pb-[calc(76px+env(safe-area-inset-bottom))] shadow-[var(--shadow-lift)]">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="font-serif text-xl">More</p>
          <button onClick={onClose} className="grid size-11 place-items-center rounded-full hover:bg-paper-deep" aria-label="Close menu" autoFocus>
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </div>
        <ul className="card divide-y divide-line overflow-hidden">
          {[...SECONDARY, { to: '/welcome?tour=1', label: 'Help & quick tour', icon: Zap }].map((s) => (
            <li key={s.to}>
              <Link to={s.to} className="flex min-h-14 items-center gap-3 px-4 text-[16px] font-medium hover:bg-paper">
                <s.icon className="size-[22px] text-primary" strokeWidth={1.75} aria-hidden />
                <span className="flex-1">{s.label}</span>
                <ChevronRight className="size-5 text-ink-mute" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function AppShell() {
  const { today } = useApp()
  const [more, setMore] = useState(false)
  const loc = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [loc.pathname])
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <Rail />
      <div className="lg:pl-[260px]">
        <header className="no-print sticky top-0 z-20 border-b border-line/70 bg-paper/88 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-4 sm:px-6 lg:px-10">
            <Link to="/" className="flex min-w-0 items-center gap-2 lg:hidden" aria-label={`Homebeat, ${today.household.homeName}. Go to Today`}>
              <LogoMark className="size-8 shrink-0 text-primary" />
              <span className="truncate font-serif text-[18px] font-medium">{today.household.homeName}</span>
            </Link>
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <span className="font-serif text-[19px] font-medium">{today.household.homeName}</span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <SimulateButton />
              <ConnectionStatus compact />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1120px] px-4 pt-5 pb-[calc(96px+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-10 lg:pt-8 lg:pb-16">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <TabBar onMore={() => setMore((m) => !m)} moreOpen={more} />
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </div>
  )
}
