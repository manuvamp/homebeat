import { Link } from 'react-router'
import { Check, ChevronRight } from 'lucide-react'
import type { Moment } from '@shared/types'
import { MOMENT_ICON, SEVERITY } from '@/lib/meta'
import { formatTime, relativeTime } from '@/lib/time'
import { SeverityBadge, SeverityIcon, cx } from './ui'

export function MomentCard({ m, fresh, showDate }: { m: Moment; fresh?: boolean; showDate?: boolean }) {
  const s = SEVERITY[m.severity]
  const loud = m.severity === 'urgent' || m.severity === 'heads_up'
  return (
    <Link
      to={`/moment/${m.id}`}
      className={cx(
        'card group relative flex gap-3.5 p-4 transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-[var(--shadow-lift)] sm:gap-4 sm:p-5',
        fresh && 'animate-arrive',
        loud && !m.ack && 'ring-2 ' + s.ring,
      )}
      aria-label={`${s.label}: ${m.title}, ${formatTime(m.at)}. ${m.body}`}
    >
      {loud && !m.ack && <span className={cx('absolute top-4 bottom-4 left-0 w-1 rounded-r-full', s.solid)} aria-hidden />}
      <SeverityIcon severity={m.severity} icon={MOMENT_ICON[m.kind]} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[16px] leading-snug font-semibold text-ink">{m.title}</p>
          {fresh && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase">New</span>}
        </div>
        <p className="mt-0.5 text-[13px] text-ink-mute tabular">
          <time dateTime={new Date(m.at).toISOString()}>{showDate ? relativeTime(m.at) : formatTime(m.at)}</time>
          {m.deviceName && <> · {m.deviceName}</>}
        </p>
        <p className="mt-1.5 line-clamp-2 text-[15px] leading-relaxed text-ink-soft">{m.body}</p>
        {(loud || m.ack) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {loud && !m.ack && <SeverityBadge severity={m.severity} />}
            {m.ack && (
              <span className="inline-flex items-center gap-1 rounded-full bg-paper-deep px-2.5 py-1 text-[13px] font-medium text-ink-soft">
                <Check className="size-[14px]" strokeWidth={2.25} aria-hidden />
                Handled by {m.ack.by}
              </span>
            )}
          </div>
        )}
      </div>
      {m.snapshotUrl ? (
        <img
          src={m.snapshotUrl}
          alt=""
          loading="lazy"
          onError={(e) => (e.currentTarget.style.display = 'none')}
          className="hidden h-[72px] w-[128px] shrink-0 self-center rounded-xl object-cover ring-1 ring-black/5 min-[420px]:block"
        />
      ) : (
        <ChevronRight className="size-5 shrink-0 self-center text-ink-mute/60 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
      )}
    </Link>
  )
}
