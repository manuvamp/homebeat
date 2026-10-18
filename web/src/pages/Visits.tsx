import { useMemo, useState } from 'react'
import { CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, Copy, Car, Link2, Pencil, Share2, Clock } from 'lucide-react'
import type { Schedule, Visit } from '@shared/types'
import { api } from '@/lib/api'
import { useApp, useAsync } from '@/lib/store'
import { plural, possessive } from '@/lib/format'
import { EVIDENCE, VISIT_STATUS, visitStatusLabel } from '@/lib/meta'
import {
  WEEKDAYS_SHORT,
  addDays,
  formatClock,
  formatDateKey,
  formatDuration,
  formatTime,
  relativeDayLabel,
  todayKey,
  weekdayOf,
} from '@/lib/time'
import { Button, Card, EmptyState, ErrorNote, PageHeader, Pill, SectionTitle, Sheet, Skeleton, cx } from '@/components/ui'
import { VisitsScheduleSheet, type ScheduleDraft } from '@/components/VisitsScheduleSheet'

function weekStartOf(date: string) {
  return addDays(date, -((weekdayOf(date) + 6) % 7)) // Monday
}

function daysLabel(days: number[]) {
  const s = [...days].sort()
  if (s.length === 7) return 'Every day'
  if (s.join() === '1,2,3,4,5') return 'Weekdays'
  if (s.join() === '0,6') return 'Weekends'
  return s.map((d) => WEEKDAYS_SHORT[d]).join(', ')
}

function firstName(who: string) {
  return who.split(' (')[0]
}

function StatusPill({ v, compact }: { v: Visit; compact?: boolean }) {
  const meta = VISIT_STATUS[v.status]
  const Icon = meta.icon
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold', compact ? 'px-2 py-1 text-[12.5px]' : 'px-3 py-1.5 text-[14px]', meta.cls)}>
      <Icon className="size-[15px] shrink-0" strokeWidth={2} aria-hidden />
      {compact && v.status === 'late' && v.lateByMin ? `Late +${v.lateByMin}m` : visitStatusLabel(v)}
    </span>
  )
}

function visitTimeLine(v: Visit) {
  if (v.arrivedAt && v.departedAt) return `${formatTime(v.arrivedAt)}–${formatTime(v.departedAt)}`
  if (v.arrivedAt) return `Arrived ${formatTime(v.arrivedAt)}`
  if (v.status === 'missed') return 'No one came'
  return `${formatTime(v.expectedStart)}–${formatTime(v.expectedEnd)}`
}

function VisitCell({ v, onOpen }: { v: Visit | undefined; onOpen: (v: Visit) => void }) {
  if (!v)
    return (
      <div className="flex min-h-[76px] items-center justify-center rounded-2xl border border-dashed border-line text-[13px] text-ink-mute/80" aria-label="Not expected">
        <span aria-hidden>—</span>
      </div>
    )
  return (
    <button
      type="button"
      onClick={() => onOpen(v)}
      className="flex min-h-[76px] w-full flex-col items-start justify-center gap-1.5 rounded-2xl bg-white p-2.5 text-left ring-1 ring-line transition-shadow hover:shadow-[var(--shadow-card)] hover:ring-line-strong"
      aria-label={`${v.who}, ${formatDateKey(v.date)}: ${visitStatusLabel(v)}, ${visitTimeLine(v)}. Show details.`}
    >
      <StatusPill v={v} compact />
      <span className="pl-1 text-[12.5px] font-medium text-ink-mute tabular">{visitTimeLine(v)}</span>
    </button>
  )
}

function WeekGrid({ start, visits, schedules, onOpen }: { start: string; visits: Visit[]; schedules: Schedule[]; onOpen: (v: Visit) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const today = todayKey()
  // Rows: every schedule that has a visit this week, plus active schedules.
  const rows = useMemo(() => {
    const ids = new Set(visits.map((v) => v.scheduleId))
    const list = schedules.filter((s) => ids.has(s.id) || s.active)
    for (const v of visits) if (!list.some((s) => s.id === v.scheduleId)) list.push({ id: v.scheduleId, label: v.label, who: v.who } as Schedule)
    return list
  }, [visits, schedules])
  const find = (sid: string, date: string) => visits.find((v) => v.scheduleId === sid && v.date === date)

  if (!rows.length)
    return (
      <Card>
        <EmptyState icon={CalendarClock} title="No visits expected yet" body="Add the aide, the nurse or the lunch delivery, and Homebeat will check they came." />
      </Card>
    )

  return (
    <>
      {/* Desktop: schedules as rows, days as columns */}
      <Card className="hidden overflow-x-auto p-4 md:block lg:p-5">
        <table className="w-full border-separate border-spacing-1.5 text-left">
          <caption className="sr-only">Visits this week, one row per expected visitor</caption>
          <thead>
            <tr>
              <th scope="col" className="w-[180px] px-2 pb-1 text-[13px] font-medium text-ink-mute">
                Expected
              </th>
              {days.map((d) => (
                <th key={d} scope="col" className="px-1 pb-1 text-center">
                  <span className={cx('inline-flex flex-col items-center rounded-xl px-2 py-1', d === today && 'bg-primary-soft text-primary')}>
                    <span className="text-[12px] font-semibold tracking-wide uppercase">{d === today ? 'Today' : WEEKDAYS_SHORT[weekdayOf(d)]}</span>
                    <span className="font-serif text-[18px] leading-tight tabular">{Number(d.slice(8))}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="px-2 align-middle">
                  <p className="text-[15px] font-semibold text-ink">{firstName(s.who)}</p>
                  <p className="text-[13px] font-normal text-ink-mute">{s.label}</p>
                </th>
                {days.map((d) => (
                  <td key={d} className="min-w-[104px] align-top">
                    <VisitCell v={find(s.id, d)} onOpen={onOpen} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Mobile: one row per day */}
      <ol className="space-y-2.5 md:hidden" aria-label="Visits this week, by day">
        {days.map((d) => {
          const dayVisits = rows.map((s) => find(s.id, d)).filter((v): v is Visit => !!v)
          return (
            <li key={d} className={cx('card flex gap-3 p-3.5', d === today && 'ring-2 ring-primary/25')}>
              <div className={cx('flex w-12 shrink-0 flex-col items-center justify-center rounded-xl py-1.5', d === today ? 'bg-primary-soft text-primary' : 'bg-paper text-ink-soft')}>
                <span className="text-[11px] font-semibold tracking-wide uppercase">{d === today ? 'Today' : WEEKDAYS_SHORT[weekdayOf(d)]}</span>
                <span className="font-serif text-[20px] leading-tight tabular">{Number(d.slice(8))}</span>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {dayVisits.length === 0 && <p className="flex min-h-12 items-center text-[15px] text-ink-mute">No visits expected</p>}
                {dayVisits.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onOpen(v)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-paper"
                    aria-label={`${v.who}: ${visitStatusLabel(v)}, ${visitTimeLine(v)}. Show details.`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{firstName(v.who)}</span>
                      <span className="block text-[13px] text-ink-mute tabular">{visitTimeLine(v)}</span>
                    </span>
                    <StatusPill v={v} compact />
                    <ChevronRight className="size-4 shrink-0 text-ink-mute/70" strokeWidth={1.75} aria-hidden />
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}

function VisitDetail({ v, onClose }: { v: Visit | null; onClose: () => void }) {
  const parent = useApp().today.household.parentName
  return (
    <Sheet open={!!v} onClose={onClose} title={v ? `${firstName(v.who)} · ${relativeDayLabel(v.date)}` : ''}>
      {v && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill v={v} />
            <span className="text-[14px] text-ink-mute">{v.label}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white p-3.5 ring-1 ring-line">
              <dt className="text-[13px] text-ink-mute">Expected</dt>
              <dd className="mt-0.5 text-[16px] font-semibold tabular">
                {formatTime(v.expectedStart)}–{formatTime(v.expectedEnd)}
              </dd>
            </div>
            <div className="rounded-2xl bg-white p-3.5 ring-1 ring-line">
              <dt className="text-[13px] text-ink-mute">{v.arrivedAt ? 'Actual visit' : 'Arrived'}</dt>
              <dd className="mt-0.5 text-[16px] font-semibold tabular">
                {v.arrivedAt ? visitTimeLine(v) : v.status === 'missed' ? 'Didn’t come' : 'Not yet'}
              </dd>
            </div>
            {v.minutes != null && (
              <div className="rounded-2xl bg-white p-3.5 ring-1 ring-line">
                <dt className="text-[13px] text-ink-mute">Time with {parent}</dt>
                <dd className="mt-0.5 text-[16px] font-semibold tabular">{formatDuration(v.minutes)}</dd>
              </div>
            )}
            {v.lateByMin ? (
              <div className="rounded-2xl bg-heads-bg p-3.5">
                <dt className="text-[13px] text-heads">Late by</dt>
                <dd className="mt-0.5 text-[16px] font-semibold text-heads tabular">{v.lateByMin} min</dd>
              </div>
            ) : null}
          </dl>

          <h3 className="mt-6 mb-3 font-serif text-[19px] font-medium">How Homebeat knows</h3>
          {v.evidence.length === 0 ? (
            <p className="rounded-2xl bg-white p-4 text-[15px] text-ink-mute ring-1 ring-line">
              {v.status === 'upcoming' ? 'Nothing yet. Homebeat starts watching a few minutes before the visit is due.' : 'No signs from the door for this visit.'}
            </p>
          ) : (
            <ol className="relative space-y-3 before:absolute before:top-3 before:bottom-3 before:left-[19px] before:w-0.5 before:bg-line">
              {[...v.evidence]
                .sort((a, b) => a.at - b.at)
                .map((e, i) => {
                  const meta = EVIDENCE[e.kind]
                  const Icon = meta.icon
                  return (
                    <li key={i} className="relative flex gap-3">
                      <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary ring-4 ring-paper" aria-hidden>
                        <Icon className="size-[18px]" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1 rounded-2xl bg-white p-3.5 ring-1 ring-line">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="text-[14px] font-semibold text-primary">{meta.label}</p>
                          <time className="text-[13px] text-ink-mute tabular">{formatTime(e.at)}</time>
                        </div>
                        <p className="mt-0.5 text-[15px] text-ink-soft">{e.detail}</p>
                        {e.snapshotUrl && (
                          <img src={e.snapshotUrl} alt={e.detail} loading="lazy" className="mt-2.5 aspect-video w-full max-w-[280px] rounded-xl object-cover ring-1 ring-black/5" />
                        )}
                      </div>
                    </li>
                  )
                })}
            </ol>
          )}
          <p className="mt-5 text-[13px] text-ink-mute">Homebeat never uses face recognition. Visits are matched from the doorbell, the car and the check-in link.</p>
        </div>
      )}
    </Sheet>
  )
}

function useCheckinShare() {
  const parent = useApp().today.household.parentName
  const [copied, setCopied] = useState<string | null>(null)
  const linkFor = (s: Schedule) => `${location.origin}/c/${s.checkinCode}`
  async function copy(s: Schedule) {
    const url = linkFor(s)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(s.id)
    setTimeout(() => setCopied((c) => (c === s.id ? null : c)), 2500)
  }
  async function share(s: Schedule) {
    const name = firstName(s.who)
    try {
      await navigator.share({
        title: 'Homebeat check-in',
        text: `Hi ${name}, please tap this link when you arrive at ${possessive(parent)}. It lets the family know you’re there.`,
        url: linkFor(s),
      })
    } catch {
      /* cancelled */
    }
  }
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return { copied, copy, share, canShare, linkFor }
}

function ScheduleCard({ s, onEdit, share }: { s: Schedule; onEdit: () => void; share: ReturnType<typeof useCheckinShare> }) {
  const name = firstName(s.who)
  return (
    <Card as="li" className={cx('flex flex-col p-5', !s.active && 'opacity-75')}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
          <CalendarClock className="size-[22px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold text-ink">{s.who}</p>
          <p className="text-[14px] text-ink-mute">{s.label}</p>
        </div>
        <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit} aria-label={`Edit ${s.who}`}>
          Edit
        </Button>
      </div>
      <div className="mt-3.5 flex flex-wrap gap-1.5">
        <Pill icon={CalendarClock}>{daysLabel(s.days)}</Pill>
        <Pill icon={Clock}>
          {formatClock(s.windowStart)}–{formatClock(s.windowEnd)}
        </Pill>
        <Pill>~{formatDuration(s.expectedMinutes)}</Pill>
        {s.vehicleHint && <Pill icon={Car}>{s.vehicleHint}</Pill>}
        {!s.active && <Pill className="bg-heads-bg text-heads">Paused</Pill>}
      </div>
      {s.checkinCode && (
        <div className="mt-4 rounded-2xl bg-paper p-3.5">
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <Link2 className="size-4 text-primary" strokeWidth={1.75} aria-hidden />
            Check-in link for {name}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-mute">One tap when {name} arrives confirms the visit, even if the doorbell misses it.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              variant={share.copied === s.id ? 'quiet' : 'secondary'}
              size="sm"
              icon={share.copied === s.id ? Check : Copy}
              onClick={() => share.copy(s)}
              aria-live="polite"
            >
              {share.copied === s.id ? 'Link copied' : `Share check-in link with ${name}`}
            </Button>
            {share.canShare && (
              <Button variant="ghost" size="sm" icon={Share2} onClick={() => share.share(s)}>
                Send…
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

export default function VisitsPage() {
  const { today: summary } = useApp()
  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayKey()))
  const weekEnd = addDays(weekStart, 6)
  const visitsQ = useAsync(() => api.visits(weekStart, weekEnd), [weekStart])
  const schedQ = useAsync(() => api.schedules(), [])
  const [openVisit, setOpenVisit] = useState<Visit | null>(null)
  const [editing, setEditing] = useState<ScheduleDraft | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const share = useCheckinShare()
  const isThisWeek = weekStart === weekStartOf(todayKey())

  const visits = visitsQ.data ?? []
  const past = visits.filter((v) => v.status !== 'upcoming' && v.status !== 'due')
  const done = past.filter((v) => v.status === 'completed' || v.status === 'late' || v.status === 'in_progress').length
  const late = past.filter((v) => v.status === 'late').length
  const missed = past.filter((v) => v.status === 'missed').length

  const rangeLabel = `${formatDateKey(weekStart, { month: 'short', day: 'numeric' })} – ${formatDateKey(weekEnd, { month: 'short', day: 'numeric' })}`

  function openSchedule(s: Schedule | null) {
    setEditing(s ? { ...s } : null)
    setSheetOpen(true)
  }

  return (
    <div>
      <PageHeader
        title="Visits"
        subtitle={`Who’s expected at ${possessive(summary.household.parentName)}, and whether they came.`}
        actions={
          <Button icon={CalendarPlus} onClick={() => openSchedule(null)}>
            Add expected visit
          </Button>
        }
      />

      <section aria-labelledby="week-title" className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="week-title" className="font-serif text-[21px] font-medium">
              {isThisWeek ? 'This week' : 'Week of ' + formatDateKey(weekStart, { month: 'long', day: 'numeric' })}
            </h2>
            <p className="text-[14px] text-ink-mute tabular">
              {rangeLabel}
              {visitsQ.data && past.length > 0 && (
                <>
                  {' · '}
                  {done} of {plural(past.length, 'visit')} happened
                  {late ? ` · ${late} late` : ''}
                  {missed ? ` · ${missed} missed` : ''}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              className="grid size-11 place-items-center rounded-full text-ink-soft ring-1 ring-line-strong hover:bg-white"
              aria-label="Previous week"
            >
              <ChevronLeft className="size-5" strokeWidth={1.75} />
            </button>
            {!isThisWeek && (
              <Button variant="ghost" size="sm" onClick={() => setWeekStart(weekStartOf(todayKey()))}>
                This week
              </Button>
            )}
            <button
              type="button"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              className="grid size-11 place-items-center rounded-full text-ink-soft ring-1 ring-line-strong hover:bg-white"
              aria-label="Next week"
            >
              <ChevronRight className="size-5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {visitsQ.error ? (
          <ErrorNote error={visitsQ.error} onRetry={visitsQ.reload} />
        ) : !visitsQ.data || !schedQ.data ? (
          <div className="space-y-2.5" aria-busy="true" aria-label="Loading visits">
            <Skeleton className="h-[84px] w-full rounded-[18px]" />
            <Skeleton className="h-[84px] w-full rounded-[18px]" />
            <Skeleton className="h-[84px] w-full rounded-[18px]" />
          </div>
        ) : (
          <WeekGrid start={weekStart} visits={visits} schedules={schedQ.data} onOpen={setOpenVisit} />
        )}

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink-mute" aria-label="What the labels mean">
          {(['completed', 'late', 'missed', 'in_progress', 'upcoming'] as const).map((k) => {
            const m = VISIT_STATUS[k]
            return (
              <li key={k} className="inline-flex items-center gap-1.5">
                <span className={cx('grid size-5 place-items-center rounded-full', m.cls)} aria-hidden>
                  <m.icon className="size-3" strokeWidth={2.25} />
                </span>
                {m.label}
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="sched-title">
        <SectionTitle id="sched-title">Expected visits</SectionTitle>
        <p className="-mt-1 mb-4 max-w-2xl text-[15px] text-ink-soft">
          Homebeat checks each visit against the doorbell. If someone is late it gives you a heads-up, and if they don’t come at all it tells you.
        </p>
        {schedQ.error ? (
          <ErrorNote error={schedQ.error} onRetry={schedQ.reload} />
        ) : !schedQ.data ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-48 rounded-[18px]" />
            <Skeleton className="h-48 rounded-[18px]" />
          </div>
        ) : schedQ.data.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarClock} title="No expected visits yet" body={`Add ${possessive(summary.household.parentName)} aide, nurse or meal delivery and Homebeat will confirm each visit.`}>
              <Button icon={CalendarPlus} onClick={() => openSchedule(null)}>
                Add expected visit
              </Button>
            </EmptyState>
          </Card>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {schedQ.data.map((s) => (
              <ScheduleCard key={s.id} s={s} onEdit={() => openSchedule(s)} share={share} />
            ))}
          </ul>
        )}
      </section>

      <VisitDetail v={openVisit} onClose={() => setOpenVisit(null)} />
      <VisitsScheduleSheet
        open={sheetOpen}
        initial={editing}
        onClose={() => setSheetOpen(false)}
        onSaved={(s) => {
          const list = schedQ.data ?? []
          schedQ.setData(list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s])
          setSheetOpen(false)
          visitsQ.reload()
        }}
        onDeleted={(id) => {
          schedQ.setData((schedQ.data ?? []).filter((x) => x.id !== id))
          setSheetOpen(false)
          visitsQ.reload()
        }}
      />
    </div>
  )
}
