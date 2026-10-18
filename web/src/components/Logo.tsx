import { cx } from './ui'

/** The Homebeat mark: a small house whose baseline becomes a heartbeat line. */
export function LogoMark({ className, tile = false }: { className?: string; tile?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none">
      {tile && <rect width="32" height="32" rx="9" fill="#1F5C4E" />}
      <path d="M7.5 18.5V12.6L16 6l8.5 6.6v5.9" stroke={tile ? '#FBF7F1' : 'currentColor'} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M3 18.5h8.2l1.9-3.6 2.6 7.6 2.5-6.4 1.5 2.4H29"
        stroke={tile ? '#9FD0B3' : '#7FA88F'}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Logo({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-primary', className)}>
      <LogoMark className={cx(size === 'sm' && 'size-7', size === 'md' && 'size-8', size === 'lg' && 'size-11')} />
      <span className={cx('font-serif font-semibold tracking-[-0.02em] text-ink', size === 'sm' && 'text-lg', size === 'md' && 'text-[21px]', size === 'lg' && 'text-[28px]')}>
        Homebeat
      </span>
    </span>
  )
}
