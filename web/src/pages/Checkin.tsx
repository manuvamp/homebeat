import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Check, HandHeart, Loader2, Link2Off } from 'lucide-react'
import { api, getMode, type HomebeatApi } from '@/lib/api'
import { LogoMark } from '@/components/Logo'
import { Button } from '@/components/ui'

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; who?: string; at: number } | { kind: 'invalid' } | { kind: 'error'; message: string }

const localTime = (t: number) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(t)

const unreachable = (e: unknown) => getMode().kind === 'real' && (e instanceof TypeError || /fetch|network|unexpected reply/i.test(String((e as Error)?.message)))

// No server reachable (demo / static hosting): use the bundled sample data so the link still works.
async function withFallback<T>(real: () => Promise<T>, mock: (m: HomebeatApi) => Promise<T>) {
  try {
    return await real()
  } catch (e) {
    if (unreachable(e)) return mock((await import('@/mock/api')).createMockApi())
    throw e
  }
}
const sendCheckin = (code: string) => withFallback(() => api.checkin(code), (m) => m.checkin(code))
const lookup = (code: string) => withFallback(() => api.checkinInfo(code), (m) => m.checkinInfo(code))

export default function CheckinPage() {
  const { code = '' } = useParams()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [info, setInfo] = useState<{ who: string; parentName: string } | null | 'loading'>('loading')

  useEffect(() => {
    let alive = true
    lookup(code).then(
      (i) => alive && setInfo(i),
      (e: { status?: number }) => {
        if (!alive) return
        if (e?.status === 404) setState({ kind: 'invalid' })
        setInfo(null)
      },
    )
    return () => {
      alive = false
    }
  }, [code])
  const who = info && info !== 'loading' ? info.who : undefined
  const parent = info && info !== 'loading' ? info.parentName : undefined

  useEffect(() => {
    document.title = 'Check in · Homebeat'
  }, [])

  async function tap() {
    setState({ kind: 'sending' })
    try {
      const r = await sendCheckin(code)
      if (r.ok) {
        setState({ kind: 'done', who: r.who ?? who, at: Date.now() })
        navigator.vibrate?.(40)
      } else setState({ kind: 'invalid' })
    } catch {
      setState({ kind: 'error', message: 'We couldn’t send that. Check your signal and tap again.' })
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(120%_60%_at_50%_0%,#E6EFE8_0%,#FBF7F1_65%)] px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-center gap-2 text-primary">
        <LogoMark className="size-7" />
        <span className="font-serif text-lg font-semibold text-ink">Homebeat</span>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center text-center">
        {state.kind === 'done' ? (
          <div role="status" className="flex flex-col items-center">
            <span className="mb-6 grid size-28 animate-arrive place-items-center rounded-full bg-primary text-white shadow-[0_16px_40px_-14px_rgb(31_92_78/0.7)]" aria-hidden>
              <Check className="size-14" strokeWidth={2.5} />
            </span>
            <h1 className="font-serif text-[32px] leading-tight font-medium">Thanks{state.who ? `, ${state.who}` : ''}.</h1>
            <p className="mt-3 text-[18px] text-ink-soft">
              The family will see you arrived at <strong className="font-semibold text-ink">{localTime(state.at)}</strong>.
            </p>
            <p className="mt-6 text-[15px] text-ink-mute">You can close this page.</p>
          </div>
        ) : state.kind === 'invalid' ? (
          <div role="alert" className="flex flex-col items-center">
            <span className="mb-6 grid size-20 place-items-center rounded-full bg-heads-bg text-heads" aria-hidden>
              <Link2Off className="size-9" strokeWidth={1.75} />
            </span>
            <h1 className="font-serif text-[28px] leading-tight font-medium">This link isn’t working</h1>
            <p className="mt-3 text-[17px] text-ink-soft">This check-in link isn’t active anymore. Ask the family for a new one.</p>
          </div>
        ) : (
          <>
            <span className="mb-5 grid size-16 place-items-center rounded-full bg-white text-primary shadow-sm" aria-hidden>
              <HandHeart className="size-8" strokeWidth={1.5} />
            </span>
            <h1 className="font-serif text-[32px] leading-tight font-medium">
              {info === 'loading' ? <span className="inline-block h-9 w-40 rounded-xl skeleton align-middle" aria-label="Loading" /> : `Hi ${who ?? 'there'}`}
            </h1>
            <p className="mt-2 text-[18px] text-ink-soft">
              Tap when you arrive{parent ? ` at ${/s$/i.test(parent) ? `${parent}’` : `${parent}’s`}` : ''}, so the family knows you’re there.
            </p>
            <button
              type="button"
              onClick={tap}
              disabled={state.kind === 'sending'}
              className="mt-10 flex min-h-[132px] w-full flex-col items-center justify-center gap-1 rounded-[36px] bg-primary text-white shadow-[0_18px_40px_-16px_rgb(31_92_78/0.75)] transition-transform active:scale-[0.98] disabled:opacity-80"
            >
              {state.kind === 'sending' ? (
                <Loader2 className="size-9 animate-spin" strokeWidth={2} aria-hidden />
              ) : (
                <span className="font-serif text-[34px] font-medium">I’m here</span>
              )}
              <span className="text-[15px] text-white/80">{state.kind === 'sending' ? 'Sending…' : 'Tap once on arrival'}</span>
            </button>
            {state.kind === 'error' && (
              <div role="alert" className="mt-5 w-full rounded-2xl bg-urgent-bg px-4 py-3 text-[15px] font-medium text-urgent">
                {state.message}
                <div className="mt-2">
                  <Button size="sm" variant="secondary" onClick={tap}>
                    Try again
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mt-8 text-center text-[13px] text-ink-mute">Only your arrival time is shared. No location, no photos.</footer>
    </div>
  )
}
