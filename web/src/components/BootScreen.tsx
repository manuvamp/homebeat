import { LogoMark } from './Logo'

export function BootScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper" role="status" aria-label="Loading Homebeat">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="size-14 animate-pulse text-primary" />
        <p className="font-serif text-lg text-ink-soft">Checking in on home…</p>
      </div>
    </div>
  )
}
