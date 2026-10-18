import { Link } from 'react-router'
import { X } from 'lucide-react'
import { useApp } from '@/lib/store'
import { SEVERITY } from '@/lib/meta'
import { cx } from './ui'

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  if (!toasts.length) return null
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3 lg:top-5 lg:right-6 lg:left-auto lg:items-end">
      {toasts.map((t) => {
        const s = SEVERITY[t.tone]
        const Icon = s.icon
        const inner = (
          <>
            <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', s.bg, s.text)} aria-hidden>
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cx('block text-[12px] font-semibold tracking-wide uppercase', s.text)}>{s.label}</span>
              <span className="block text-[15px] leading-snug font-semibold text-ink">{t.title}</span>
              {t.body && <span className="mt-0.5 line-clamp-2 block text-[14px] text-ink-soft">{t.body}</span>}
            </span>
          </>
        )
        return (
          <div
            key={t.id}
            className={cx('pointer-events-auto flex w-full max-w-[400px] animate-toast-in items-start gap-2 rounded-[20px] bg-white p-3 pr-2 shadow-[var(--shadow-lift)] ring-1', s.ring)}
          >
            {t.href ? (
              <Link to={t.href} onClick={() => dismissToast(t.id)} className="flex min-w-0 flex-1 items-start gap-3 rounded-xl">
                {inner}
              </Link>
            ) : (
              <div className="flex min-w-0 flex-1 items-start gap-3">{inner}</div>
            )}
            <button onClick={() => dismissToast(t.id)} className="grid size-9 shrink-0 place-items-center rounded-full text-ink-mute hover:bg-paper-deep" aria-label="Dismiss">
              <X className="size-[18px]" strokeWidth={1.75} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
