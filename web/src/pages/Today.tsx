import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { BatteryMedium, CalendarClock, ChevronDown, ChevronRight, DoorClosed, Lock, Plug, Sparkles, WifiOff } from 'lucide-react'
import type { Moment, Visit } from '@shared/types'
import { useApp } from '@/lib/store'
import { api } from '@/lib/api'
import { DEVICE_ICON, SEVERITY, VISIT_STATUS, visitStatusLabel } from '@/lib/meta'
import { addDays, dayPart, formatDateKey, formatLongDay, formatTime, greeting, now, relativeDayLabel, relativeTime, todayKey, type DayPart } from '@/lib/time'
import { pluralWord } from '@/lib/format'
import { SimulatorEntry } from '@/components/SimulatorPanel'
import { MomentCard } from '@/components/MomentCard'
import { Card, EmptyState, SectionTitle, Skeleton, cx } from '@/components/ui'

function useTick(ms = 30_000) {
  const [, set] = useState(0)
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}

function StatusHero() {
  const { today } = useApp()
  const { status, lastSeenAt, household } = today
  const s = SEVERITY[status.severity]
  const Icon = s.icon
  return (
    <section
      aria-labelledby="status-headline"
      className={cx('relative overflow-hidden rounded-[24px] p-6 pb-14 sm:p-7 sm:pb-14', s.bg)}
    >
      <svg className={cx('pointer-events-none absolute inset-x-0 bottom-3 h-9 w-full opacity-[0.22]', s.text)} viewBox="0 0 400 36" preserveAspectRatio="none" fill="none" aria-hidden>
        <path d="M0 22H300l8-12 10 22 9-18 6 8H400" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="relative flex items-start gap-4">
        <span className={cx('grid size-12 shrink-0 place-items-center rounded-2xl bg-white/70', s.text)} aria-hidden>
          <Icon className="size-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className={cx('text-[13px] font-semibold tracking-wide uppercase', s.text)}>{s.label}</p>
          <h2 id="status-headline" className="mt-0.5 font-serif text-[26px] leading-tight font-medium text-ink sm:text-[30px]">
            {status.headline}
          </h2>
          <p className="mt-1.5 text-[16px] text-ink-soft">{status.detail}</p>
          {lastSeenAt && (
            <p className="mt-3 text-[14px] text-ink-mute">
              Last activity at {household.parentName}’s door {relativeTime(lastSeenAt)}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function Countdown({ v }: { v: Visit }) {
  useTick(15_000)
  const t = now()
  if (v.status === 'in_progress') return <>Here now</>
  if (t >= v.expectedStart && t <= v.expectedEnd) return <>Due now · on time until {formatTime(v.expectedEnd)}</>
  if (t > v.expectedEnd) return <>Expected by {formatTime(v.expectedEnd)} · {relativeTime(v.expectedEnd)}</>
  return <>{relativeTime(v.expectedStart)}</>
}

function NextVisitCard({ v: next }: { v?: Visit }) {
  const { today } = useApp()
  const v = today.visitsToday.find((x) => x.status === 'in_progress' || x.status === 'due') ?? next
  if (!v)
    return (
      <Card className="p-5">
        <p className="text-[13px] font-semibold tracking-wide text-ink-mute uppercase">Next expected visit</p>
        <p className="mt-2 text-[15px] text-ink-soft">{today.visitsToday.length ? 'Nothing else expected for now.' : 'No visits on the calendar this week.'}</p>
        <Link to="/visits" className="mt-3 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-primary">
          Add an expected visit <ChevronRight className="size-4" aria-hidden />
        </Link>
      </Card>
    )
  return (
    <Card className="p-5">
      <p className="text-[13px] font-semibold tracking-wide text-ink-mute uppercase">{v.status === 'due' || v.status === 'in_progress' ? 'Expected visit' : 'Next expected visit'}</p>
      <div className="mt-3 flex items-start gap-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
          <CalendarClock className="size-[22px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-[17px] font-semibold">{v.who}</p>
          <p className="text-[15px] text-ink-soft">
            {v.label} · {relativeDayLabel(v.date)} {formatTime(v.expectedStart)}–{formatTime(v.expectedEnd)}
          </p>
          <p className="mt-2 inline-flex items-center rounded-full bg-paper-deep px-3 py-1 text-[14px] font-semibold text-ink tabular">
            <Countdown v={v} />
          </p>
        </div>
      </div>
    </Card>
  )
}

function VisitChips({ visits }: { visits: Visit[] }) {
  if (!visits.length) return <p className="text-[15px] text-ink-mute">No visits expected today.</p>
  return (
    <ul className="flex flex-col gap-2">
      {visits.map((v) => {
        const st = VISIT_STATUS[v.status]
        const Icon = st.icon
        return (
          <li key={v.id}>
            <Link to="/visits" className="flex min-h-12 items-center gap-3 rounded-2xl bg-paper px-3.5 py-2.5 hover:bg-paper-deep">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{v.who}</span>
                <span className="block text-[13px] text-ink-mute tabular">
                  {v.status === 'in_progress' && v.arrivedAt
                    ? `Arrived ${formatTime(v.arrivedAt)} · here now`
                    : v.arrivedAt
                      ? `${formatTime(v.arrivedAt)}${v.departedAt ? `–${formatTime(v.departedAt)}` : ''}`
                      : `Expected ${formatTime(v.expectedStart)}–${formatTime(v.expectedEnd)}`}
                  {v.minutes ? ` · ${v.minutes} min` : ''}
                </span>
              </span>
              <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold', st.cls)}>
                <Icon className="size-[14px]" strokeWidth={2} aria-hidden />
                {visitStatusLabel(v)}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function DeviceStrip() {
  const { today } = useApp()
  return (
    <ul className="grid gap-2" aria-label="Devices">
      {today.devices.map((d) => {
        const Icon = DEVICE_ICON[d.kind]
        const offline = d.online === false
        return (
          <li key={d.id} className="flex min-h-11 items-center gap-3 text-[14px]">
            <Icon className="size-5 text-ink-mute" strokeWidth={1.75} aria-hidden />
            <span className="flex-1 font-medium">{d.name}</span>
            {d.encrypted && (
              <span className="inline-flex items-center gap-1 text-ink-mute" title="End-to-end encrypted">
                <Lock className="size-4" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">End-to-end encrypted</span>
              </span>
            )}
            {typeof d.battery === 'number' ? (
              <span className={cx('inline-flex items-center gap-1 tabular', d.battery < 20 ? 'text-heads' : 'text-ink-mute')}>
                <BatteryMedium className="size-4" strokeWidth={1.75} aria-hidden />
                {d.battery}%
              </span>
            ) : d.kind !== 'chime' ? (
              <span className="inline-flex items-center gap-1 text-ink-mute">
                <Plug className="size-4" strokeWidth={1.75} aria-hidden /> Wired
              </span>
            ) : null}
            <span className={cx('inline-flex items-center gap-1.5 font-medium', offline ? 'text-heads' : 'text-calm')}>
              {offline ? <WifiOff className="size-4" strokeWidth={1.75} aria-hidden /> : <span className="size-2 rounded-full bg-[#3f9a6e]" aria-hidden />}
              {offline ? 'Offline' : 'Online'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const PART_ORDER: DayPart[] = ['Night', 'Evening', 'Afternoon', 'Morning', 'Early hours']

function Timeline({ moments, fresh, emptyTitle }: { moments: Moment[]; fresh?: Set<string>; emptyTitle?: string }) {
  const groups = useMemo(() => {
    const g = new Map<DayPart, Moment[]>()
    for (const m of moments) {
      const p = dayPart(m.at)
      g.set(p, [...(g.get(p) ?? []), m])
    }
    return PART_ORDER.filter((p) => g.has(p)).map((p) => [p, g.get(p)!] as const)
  }, [moments])
  if (!moments.length)
    return (
      <Card>
        <EmptyState icon={DoorClosed} title={emptyTitle ?? 'Nothing at the door yet today'} body="When something worth knowing happens, it will show up here." />
      </Card>
    )
  return (
    <div className="space-y-6">
      {groups.map(([part, ms]) => (
        <section key={part} aria-label={part}>
          <h3 className="mb-2.5 flex items-center gap-3 text-[13px] font-semibold tracking-wide text-ink-mute uppercase">
            {part}
            <span className="h-px flex-1 bg-line" aria-hidden />
          </h3>
          <ol className="space-y-3">
            {ms.map((m) => (
              <li key={m.id}>
                <MomentCard m={m} fresh={fresh?.has(m.id)} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function EarlierDays() {
  const { rememberMoments } = useApp()
  const [days, setDays] = useState<{ date: string; moments: Moment[] }[]>([])
  const [loading, setLoading] = useState(false)
  const next = addDays(days.length ? days[days.length - 1].date : todayKey(), -1)
  const canMore = days.length < 6
  const load = async () => {
    setLoading(true)
    try {
      const ms = await api.moments(next)
      rememberMoments(ms)
      setDays((d) => [...d, { date: next, moments: ms }])
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="mt-8 space-y-8">
      {days.map((d) => (
        <section key={d.date} aria-label={relativeDayLabel(d.date)}>
          <SectionTitle>{relativeDayLabel(d.date) === 'Yesterday' ? `Yesterday · ${formatDateKey(d.date)}` : formatDateKey(d.date, { weekday: 'long', month: 'short', day: 'numeric' })}</SectionTitle>
          <Timeline moments={d.moments} emptyTitle="A quiet day at the door" />
        </section>
      ))}
      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full rounded-[18px]" />
          <Skeleton className="h-24 w-full rounded-[18px]" />
        </div>
      )}
      {canMore && !loading && (
        <button
          onClick={load}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line-strong text-[15px] font-medium text-ink-soft hover:border-primary hover:text-primary"
        >
          <ChevronDown className="size-[18px]" strokeWidth={1.75} aria-hidden />
          Show {relativeDayLabel(next) === 'Yesterday' ? 'yesterday' : formatDateKey(next, { weekday: 'long' })}
        </button>
      )}
    </div>
  )
}

export default function TodayPage() {
  const { today, fresh } = useApp()
  const primary = today.household.members.find((m) => m.role === 'primary')
  useTick(60_000)
  const { counts } = today
  return (
    <div>
      <header className="mb-5 lg:mb-7">
        <p className="text-[15px] text-ink-mute">{formatLongDay(now())}</p>
        <h1 className="mt-0.5 font-serif text-[32px] leading-tight font-medium lg:text-[40px]">
          {greeting()}
          {primary ? `, ${primary.name}` : ''}
        </h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="min-w-0 space-y-6">
          <StatusHero />
          <p className="flex items-center gap-2 text-[15px] text-ink-soft">
            <Sparkles className="size-[18px] shrink-0 text-sage" strokeWidth={1.75} aria-hidden />
            <span>
              <span className="font-semibold text-ink tabular">{counts.rawEvents}</span> motion {pluralWord(counts.rawEvents, 'alert')} today →{' '}
              <span className="font-semibold text-ink tabular">{counts.moments}</span> {pluralWord(counts.moments, 'moment')} worth knowing.{' '}
              <Link to="/how" className="font-medium text-primary underline-offset-2 hover:underline">
                How?
              </Link>
            </span>
          </p>
          {/* On mobile the visit cards sit above the timeline */}
          <div className="space-y-4 lg:hidden">
            <NextVisitCard v={today.nextVisit} />
          </div>
          <section aria-labelledby="timeline-title">
            <SectionTitle id="timeline-title">Today at {today.household.homeName.replace(/ home$/, ' door')}</SectionTitle>
            <Timeline moments={today.moments} fresh={fresh} />
            <EarlierDays />
            <SimulatorEntry />
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start" aria-label="At a glance">
          <div className="hidden lg:block">
            <NextVisitCard v={today.nextVisit} />
          </div>
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-semibold tracking-wide text-ink-mute uppercase">Today’s visits</p>
              <Link to="/visits" className="text-[14px] font-medium text-primary">
                Week
              </Link>
            </div>
            <VisitChips visits={today.visitsToday} />
          </Card>
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-semibold tracking-wide text-ink-mute uppercase">Devices</p>
              <Link to="/settings#devices" className="text-[14px] font-medium text-primary">
                Manage
              </Link>
            </div>
            <DeviceStrip />
          </Card>
        </aside>
      </div>
    </div>
  )
}
