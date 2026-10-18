import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Loader2, X, type LucideIcon } from 'lucide-react'
import type { Severity } from '@shared/types'
import { SEVERITY } from '@/lib/meta'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger' | 'urgent'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_2px_6px_-2px_rgb(31_92_78/0.5)]',
  secondary: 'bg-white text-ink ring-1 ring-line-strong hover:bg-paper hover:ring-ink/25',
  ghost: 'text-primary hover:bg-primary-soft',
  quiet: 'bg-paper-deep text-ink hover:bg-line',
  danger: 'bg-white text-urgent ring-1 ring-urgent/30 hover:bg-urgent-bg',
  urgent: 'bg-urgent text-white hover:bg-[#9c3123]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-[background,box-shadow,color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' && 'min-h-9 px-3.5 text-sm',
        size === 'md' && 'min-h-11 px-5 text-[15px]',
        size === 'lg' && 'min-h-14 px-7 text-base',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-[18px] animate-spin" strokeWidth={2} aria-hidden /> : Icon ? <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden /> : null}
      {children}
    </button>
  )
})

export function ButtonLink({
  to,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...rest
}: { to: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon; className?: string; children: ReactNode; 'aria-label'?: string }) {
  return (
    <Link
      to={to}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-full font-medium transition-colors duration-150',
        size === 'sm' && 'min-h-9 px-3.5 text-sm',
        size === 'md' && 'min-h-11 px-5 text-[15px]',
        size === 'lg' && 'min-h-14 px-7 text-base',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />}
      {children}
    </Link>
  )
}

export function Card({ className, children, as: As = 'div', ...rest }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' | 'li' } & Record<string, unknown>) {
  return (
    <As className={cx('card', className)} {...rest}>
      {children}
    </As>
  )
}

export function SeverityBadge({ severity, label, className }: { severity: Severity; label?: string; className?: string }) {
  const s = SEVERITY[severity]
  const Icon = s.icon
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold', s.bg, s.text, className)}>
      <Icon className="size-[15px]" strokeWidth={2} aria-hidden />
      {label ?? s.label}
    </span>
  )
}

export function SeverityIcon({ severity, icon, size = 'md' }: { severity: Severity; icon: LucideIcon; size?: 'sm' | 'md' | 'lg' }) {
  const s = SEVERITY[severity]
  const Icon = icon
  return (
    <span
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-2xl',
        s.bg,
        s.text,
        size === 'sm' && 'size-9 rounded-xl',
        size === 'md' && 'size-11',
        size === 'lg' && 'size-14 rounded-[20px]',
      )}
      aria-hidden
    >
      <Icon className={cx(size === 'sm' ? 'size-[18px]' : size === 'md' ? 'size-[22px]' : 'size-7')} strokeWidth={1.75} />
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}

export function EmptyState({ icon: Icon, title, body, children, className }: { icon: LucideIcon; title: string; body?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
      <span className="mb-4 grid size-16 place-items-center rounded-full bg-calm-bg text-calm" aria-hidden>
        <Icon className="size-7" strokeWidth={1.5} />
      </span>
      <p className="font-serif text-xl text-ink">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-[15px] text-ink-mute">{body}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled, describedBy }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; describedBy?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-line-strong',
      )}
    >
      <span className={cx('inline-block size-6 rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-[24px]' : 'translate-x-1')} />
    </button>
  )
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  eyebrow,
  printHidden,
}: {
  title: ReactNode
  subtitle?: ReactNode
  back?: string
  actions?: ReactNode
  eyebrow?: ReactNode
  /** Hide in print (pages with their own print header). */
  printHidden?: boolean
}) {
  return (
    <header className={cx('mb-6 flex flex-wrap items-end justify-between gap-4 pt-2 lg:mb-8', printHidden && 'no-print')}>
      <div className="min-w-0">
        {back && (
          <Link to={back} className="no-print mb-3 -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-[15px] font-medium text-primary hover:bg-primary-soft">
            <ArrowLeft className="size-[18px]" strokeWidth={1.75} aria-hidden />
            Back
          </Link>
        )}
        {eyebrow && <p className="mb-1 text-sm font-medium text-ink-mute">{eyebrow}</p>}
        <h1 className="font-serif text-[30px] leading-[1.15] font-medium text-ink lg:text-[36px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[16px] text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="font-serif text-[21px] font-medium text-ink">
        {children}
      </h2>
      {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
    </div>
  )
}

/** Bottom sheet on mobile, centered dialog on desktop. Focus-trapped, Esc to close. */
export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute('disabled'))
    requestAnimationFrame(() => (focusables()[1] ?? focusables()[0])?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-ink/35 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'relative flex max-h-[92dvh] w-full animate-sheet-up flex-col rounded-t-[28px] bg-paper shadow-[var(--shadow-lift)] sm:rounded-[28px]',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-2">
          <h2 id={titleId} className="font-serif text-[22px] font-medium">
            {title}
          </h2>
          <button onClick={onClose} className="-mr-2 grid size-11 place-items-center rounded-full text-ink-soft hover:bg-paper-deep" aria-label="Close">
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="border-t border-line px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[15px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-sm text-ink-mute">{hint}</p>}
    </div>
  )
}

export const inputCls =
  'w-full min-h-12 rounded-2xl border border-line-strong bg-white px-4 text-[16px] text-ink placeholder:text-ink-mute/70 transition-shadow focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15'

export function Pill({ children, className, icon: Icon }: { children: ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium', className ?? 'bg-paper-deep text-ink-soft')}>
      {Icon && <Icon className="size-[14px]" strokeWidth={2} aria-hidden />}
      {children}
    </span>
  )
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-3 p-5">
      <p className="font-serif text-lg">We couldn’t load this just now.</p>
      <p className="text-[15px] text-ink-mute">{friendlyError(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Card>
  )
}

export function friendlyError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  if (/failed to fetch|network/i.test(msg)) return 'Homebeat can’t reach its server. Check your connection and try again.'
  return msg || 'Something went wrong. Please try again.'
}

export function StatusDot({ tone, pulse, className }: { tone: 'ok' | 'warn' | 'off'; pulse?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'inline-block size-2.5 shrink-0 rounded-full',
        tone === 'ok' && 'bg-[#3f9a6e] text-[#3f9a6e]',
        tone === 'warn' && 'bg-heads text-heads',
        tone === 'off' && 'bg-ink-mute/50 text-ink-mute',
        pulse && 'pulse-dot',
        className,
      )}
      aria-hidden
    />
  )
}
