import { useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, HeartHandshake, Hourglass, CircleSlash, Package, MoonStar, Footprints, Printer, Share2, Sparkles, CheckCircle2, type LucideIcon } from 'lucide-react'
import type { DailyDigest, WeeklyReport } from '@shared/types'
import { api } from '@/lib/api'
import { useApp, useAsync } from '@/lib/store'
import { plural, possessive } from '@/lib/format'
import { VISIT_STATUS, visitStatusLabel } from '@/lib/meta'
import { addDays, formatDateKey, formatLongDay, now, relativeDayLabel, todayKey } from '@/lib/time'
import { Button, Card, ErrorNote, PageHeader, Skeleton, cx } from '@/components/ui'
import { Logo } from '@/components/Logo'

type Tab = 'week' | 'digest'

export default function ReportPage() {
  const { today, pushToast } = useApp()
  const [tab, setTab] = useState<Tab>('week')
  const parent = today.household.parentName
  const sibling = today.household.members.find((m) => m.role === 'family')?.name ?? 'family'

  async function share() {
    const url = location.href
    const title = tab === 'week' ? `Weekly care report · ${today.household.homeName}` : `Daily digest · ${today.household.homeName}`
    const text = `Here's how things went at ${parent}'s this ${tab === 'week' ? 'week' : 'day'}.`
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      pushToast({ tone: 'calm', title: 'Link copied', body: `Paste it in a message to ${sibling}.` })
    } catch {
      pushToast({ tone: 'note', title: 'Couldn’t copy the link', body: url })
    }
  }

  return (
    <div>
      <PageHeader
        printHidden
        title="Care report"
        subtitle={`A simple record of visits and comings and goings at ${parent}'s, ready to share with ${sibling} or the care agency.`}
        actions={
          <>
            <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
              Print
            </Button>
            <Button icon={Share2} onClick={share}>
              Share with {sibling}
            </Button>
          </>
        }
      />

      <div className="no-print mb-6 inline-flex rounded-full bg-paper-deep p-1" role="tablist" aria-label="Report type">
        {(
          [
            ['week', 'This week'],
            ['digest', 'Daily digest'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx(
              'min-h-11 rounded-full px-5 text-[15px] font-medium transition-colors',
              tab === k ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'week' ? <Weekly /> : <Digest />}
    </div>
  )
}

function PrintHeader({ title }: { title: string }) {
  return (
    <div className="print-only mb-6 border-b border-line pb-4">
      <Logo />
      <p className="mt-3 font-serif text-2xl">{title}</p>
      <p className="text-sm text-ink-mute">Generated {formatLongDay(now())} by Homebeat</p>
    </div>
  )
}

function StatTile({ icon: Icon, label, value, sub, tone }: { icon: LucideIcon; label: string; value: string; sub?: string; tone: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <span className={cx('mb-3 grid size-10 place-items-center rounded-xl', tone)} aria-hidden>
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <p className="font-serif text-[28px] leading-none font-medium tabular">{value}</p>
      <p className="mt-1.5 text-[14px] font-medium text-ink-soft">{label}</p>
      {sub && <p className="text-[13px] text-ink-mute">{sub}</p>}
    </Card>
  )
}

function Weekly() {
  const { today } = useApp()
  const [weekOf, setWeekOf] = useState(() => addDays(todayKey(), -6))
  const { data, error, loading, reload } = useAsync(() => api.report(weekOf), [weekOf])
  const weekEnd = addDays(weekOf, 6)
  const range = `${formatDateKey(weekOf, { month: 'short', day: 'numeric' })} – ${formatDateKey(weekEnd, { month: 'short', day: 'numeric' })}`
  const isCurrent = weekEnd >= todayKey()

  return (
    <section aria-labelledby="week-title">
      <PrintHeader title={`Weekly care report · ${today.household.homeName} · week of ${range}`} />
      <div className="no-print mb-5 flex items-center gap-2">
        <button
          onClick={() => setWeekOf(addDays(weekOf, -7))}
          className="grid size-11 place-items-center rounded-full ring-1 ring-line-strong hover:bg-white"
          aria-label="Previous week"
        >
          <ChevronLeft className="size-5" strokeWidth={1.75} />
        </button>
        <p id="week-title" className="min-w-[150px] text-center font-serif text-[19px]">
          {isCurrent ? 'Last 7 days' : range}
        </p>
        <button
          onClick={() => setWeekOf(addDays(weekOf, 7))}
          disabled={isCurrent}
          className="grid size-11 place-items-center rounded-full ring-1 ring-line-strong hover:bg-white disabled:opacity-40"
          aria-label="Next week"
        >
          <ChevronRight className="size-5" strokeWidth={1.75} />
        </button>
        {isCurrent && <span className="text-[14px] text-ink-mute">{range}</span>}
      </div>

      {error ? (
        <ErrorNote error={error} onRetry={reload} />
      ) : loading || !data ? (
        <WeeklySkeleton />
      ) : (
        <WeeklyBody r={data} />
      )}
    </section>
  )
}

function WeeklySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-[18px]" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-[18px]" />
    </div>
  )
}

function WeeklyBody({ r }: { r: WeeklyReport }) {
  const parent = useApp().today.household.parentName
  const v = r.visits
  const hours = v.careMinutes / 60
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
        <StatTile icon={HeartHandshake} label="Visits completed" value={`${v.completed}/${v.scheduled}`} tone="bg-primary-soft text-primary" />
        <StatTile icon={CheckCircle2} label="On time" value={String(v.onTime)} tone="bg-calm-bg text-calm" />
        <StatTile icon={Hourglass} label="Late" value={String(v.late)} tone="bg-heads-bg text-heads" />
        <StatTile icon={CircleSlash} label="Missed" value={String(v.missed)} tone="bg-urgent-bg text-urgent" />
        <StatTile
          icon={Clock}
          label="Care time"
          value={hours >= 1 ? `${hours.toFixed(1)} h` : `${v.careMinutes} min`}
          sub={`${plural(v.careMinutes, 'minute')} with ${parent}`}
          tone="bg-note-bg text-note"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card as="section" className="overflow-hidden" aria-labelledby="days-title">
          <h2 id="days-title" className="px-5 pt-5 pb-3 font-serif text-[21px] font-medium">
            Day by day
          </h2>
          <ul className="divide-y divide-line">
            {r.byDay.map((d) => (
              <li key={d.date} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:gap-4">
                <p className="w-28 shrink-0 text-[15px] font-semibold">
                  {relativeDayLabel(d.date) === 'Today' || relativeDayLabel(d.date) === 'Yesterday'
                    ? `${relativeDayLabel(d.date)}`
                    : formatDateKey(d.date)}
                </p>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {d.visits.length === 0 && <span className="text-[14px] text-ink-mute">No visits scheduled</span>}
                  {d.visits.map((vi) => {
                    const s = VISIT_STATUS[vi.status]
                    const Icon = s.icon
                    return (
                      <span key={vi.id} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium', s.cls)}>
                        <Icon className="size-[14px]" strokeWidth={2} aria-hidden />
                        {vi.who.split(' (')[0]} · {visitStatusLabel(vi)}
                      </span>
                    )
                  })}
                </div>
                <div className="flex shrink-0 gap-3 text-[13px] text-ink-mute tabular">
                  <span className="inline-flex items-center gap-1" title="Deliveries">
                    <Package className="size-[15px]" strokeWidth={1.75} aria-hidden />
                    <span className="sr-only">Deliveries:</span>
                    {d.deliveries}
                  </span>
                  <span className="inline-flex items-center gap-1" title="After dark">
                    <MoonStar className="size-[15px]" strokeWidth={1.75} aria-hidden />
                    <span className="sr-only">After dark:</span>
                    {d.afterDark}
                  </span>
                  <span className="inline-flex items-center gap-1" title="Outings">
                    <Footprints className="size-[15px]" strokeWidth={1.75} aria-hidden />
                    <span className="sr-only">Outings:</span>
                    {d.outings}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-3 text-[13px] text-ink-mute">
            <Package className="mr-1 inline size-[14px]" strokeWidth={1.75} aria-hidden /> deliveries ·{' '}
            <MoonStar className="mx-1 inline size-[14px]" strokeWidth={1.75} aria-hidden /> after dark ·{' '}
            <Footprints className="mx-1 inline size-[14px]" strokeWidth={1.75} aria-hidden /> times {parent} went out
          </p>
        </Card>

        <Card as="section" className="h-fit p-5" aria-labelledby="hl-title">
          <h2 id="hl-title" className="mb-3 flex items-center gap-2 font-serif text-[21px] font-medium">
            <Sparkles className="size-5 text-primary" strokeWidth={1.75} aria-hidden />
            Highlights
          </h2>
          <ul className="space-y-3">
            {r.highlights.map((h, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink-soft">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-sage" aria-hidden />
                {h}
              </li>
            ))}
          </ul>
          {r.sample && <p className="mt-5 text-[13px] text-ink-mute">Sample data, shown until Homebeat has a full week from {possessive(parent)} Ring devices.</p>}
        </Card>
      </div>
    </div>
  )
}

function Digest() {
  const { today } = useApp()
  const days = Array.from({ length: 7 }, (_, i) => addDays(todayKey(), -i))
  const [date, setDate] = useState(days[0])
  const { data, error, loading, reload } = useAsync(() => api.digest(date), [date])
  return (
    <section aria-label="Daily digest">
      <PrintHeader title={`Daily digest · ${today.household.homeName} · ${formatDateKey(date, { weekday: 'long', month: 'long', day: 'numeric' })}`} />
      <div className="no-print scrollbar-none -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Choose a day">
        {days.map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={d === date}
            onClick={() => setDate(d)}
            className={cx(
              'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors',
              d === date ? 'bg-primary text-white' : 'bg-white text-ink-soft ring-1 ring-line-strong hover:ring-ink/25',
            )}
          >
            {d === days[0] && <CalendarDays className="size-4" strokeWidth={1.75} aria-hidden />}
            {relativeDayLabel(d)}
          </button>
        ))}
      </div>
      {error ? (
        <ErrorNote error={error} onRetry={reload} />
      ) : loading || !data ? (
        <Skeleton className="h-72 rounded-[18px]" />
      ) : (
        <DigestBody d={data} />
      )}
    </section>
  )
}

function DigestBody({ d }: { d: DailyDigest }) {
  const s = d.stats
  const stats: [string, string, LucideIcon][] = [
    [`${s.visitsCompleted}/${s.visitsExpected}`, 'visits', HeartHandshake],
    [String(s.deliveries), s.deliveries === 1 ? 'delivery' : 'deliveries', Package],
    [String(s.afterDark), 'after dark', MoonStar],
    [String(s.outings), s.outings === 1 ? 'outing' : 'outings', Footprints],
  ]
  return (
    <Card className="mx-auto max-w-3xl p-6 sm:p-8">
      <p className="text-[14px] font-medium text-ink-mute">{formatDateKey(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h2 className="mt-1 font-serif text-[26px] leading-tight font-medium sm:text-[30px]">{d.headline}</h2>
      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([v, l, Icon]) => (
          <div key={l} className="rounded-2xl bg-paper p-3.5">
            <Icon className="mb-2 size-5 text-primary" strokeWidth={1.75} aria-hidden />
            <dt className="sr-only">{l}</dt>
            <dd className="font-serif text-[24px] leading-none tabular">{v}</dd>
            <p className="mt-1 text-[13px] text-ink-mute" aria-hidden>
              {l}
            </p>
          </div>
        ))}
      </dl>
      <ul className="mt-6 space-y-3">
        {d.bullets.map((b, i) => (
          <li key={i} className="flex gap-3 text-[16px] leading-relaxed text-ink-soft">
            <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-sage" aria-hidden />
            {b}
          </li>
        ))}
      </ul>
      {d.sample && <p className="mt-6 text-[13px] text-ink-mute">Sample data</p>}
    </Card>
  )
}
