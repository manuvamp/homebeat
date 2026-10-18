import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowRight, BellRing, CalendarClock, Check, CloudMoon, MoonStar, Package, PartyPopper, Wifi, WifiOff } from 'lucide-react'
import type { Device } from '@shared/types'
import { api } from '@/lib/api'
import { useApp, useAsync } from '@/lib/store'
import { membersByOrder, plural, possessive } from '@/lib/format'
import { WEEKDAYS_LETTER, WEEKDAYS_SHORT, formatClock } from '@/lib/time'
import { DEVICE_ICON } from '@/lib/meta'
import { Logo } from '@/components/Logo'
import { Button, Card, Skeleton, Toggle, cx } from '@/components/ui'

function markDone() {
  try {
    localStorage.setItem('homebeat.tourDone', '1')
  } catch {
    /* private mode */
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[radial-gradient(120%_70%_at_50%_0%,#E6EFE8_0%,#FBF7F1_60%)]">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pt-10">
        <header className="mb-8 flex items-center justify-center">
          <Logo />
        </header>
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
      </div>
    </div>
  )
}

function Linked({ onTour }: { onTour: () => void }) {
  const { today } = useApp()
  const navigate = useNavigate()
  const [devices, setDevices] = useState<Device[] | null>(null)
  useEffect(() => {
    let alive = true
    api.setupStatus().then(
      (s) => alive && setDevices(s.devices.length ? s.devices : today.devices),
      () => alive && setDevices(today.devices),
    )
    return () => {
      alive = false
    }
  }, [today.devices])
  const parent = today.household.parentName
  return (
    <div className="flex flex-1 flex-col">
      <div className="text-center">
        <span className="mx-auto mb-5 grid size-20 animate-arrive place-items-center rounded-full bg-primary text-white shadow-[0_10px_30px_-10px_rgb(31_92_78/0.6)]" aria-hidden>
          <Check className="size-10" strokeWidth={2.5} />
        </span>
        <h1 className="font-serif text-[34px] leading-tight font-medium">Account linked!</h1>
        <p className="mx-auto mt-2 max-w-sm text-[16px] text-ink-soft">
          Homebeat is now connected to {today.household.homeName}. Here’s what it can see.
        </p>
      </div>

      <Card className="mt-8 overflow-hidden">
        <p className="border-b border-line px-5 py-3 text-[14px] font-medium text-ink-mute">Connected devices</p>
        {devices === null ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {devices.map((d) => {
              const Icon = DEVICE_ICON[d.kind]
              const off = d.online === false
              return (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="grid size-10 place-items-center rounded-xl bg-paper-deep text-primary" aria-hidden>
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <span className="flex-1 font-semibold">{d.name}</span>
                  <span className={cx('inline-flex items-center gap-1.5 text-[14px] font-medium', off ? 'text-heads' : 'text-calm')}>
                    {off ? <WifiOff className="size-4" strokeWidth={2} aria-hidden /> : <Wifi className="size-4" strokeWidth={2} aria-hidden />}
                    {off ? 'Offline' : 'Online'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <section className="mt-8" aria-labelledby="next-title">
        <h2 id="next-title" className="font-serif text-[21px] font-medium">
          What happens next
        </h2>
        <ul className="mt-3 space-y-3 text-[15px] text-ink-soft">
          {[
            `Homebeat quietly reads ${parent}’s doorbell alerts and keeps only the moments that matter.`,
            'You’ll see visits, deliveries and anything after dark on your Today screen.',
            'Only real heads-ups reach your phone. Everything else waits for you in the daily digest.',
          ].map((t) => (
            <li key={t} className="flex gap-3">
              <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-calm-bg text-calm" aria-hidden>
                <Check className="size-3" strokeWidth={3} />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-auto flex flex-col gap-3 pt-10">
        <Button size="lg" onClick={() => navigate('/')}>
          Go to Today
        </Button>
        <Button size="lg" variant="ghost" onClick={onTour}>
          Take the 1-minute tour
        </Button>
      </div>
    </div>
  )
}

const STEPS = ['Add expected visits', 'Pick what matters', 'Who gets told'] as const

function StepVisits() {
  const sched = useAsync(() => api.schedules(), [])
  const s = sched.data?.find((x) => x.active) ?? sched.data?.[0]
  const example = !s
  const days = s?.days ?? [1, 2, 3, 4, 5]
  const weekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
  return (
    <>
      <p className="text-[16px] text-ink-soft">
        Tell Homebeat who usually comes and when. It confirms each visit, and lets you know if someone is late or doesn’t come.
      </p>
      <Card className={cx('relative mt-6 p-5', example && 'border-dashed')}>
        {example && !sched.loading && (
          <span className="absolute -top-3 right-4 rounded-full bg-paper-deep px-2.5 py-0.5 text-[12px] font-semibold tracking-wide text-ink-mute uppercase">Example</span>
        )}
        <div className="flex items-start gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
            <CalendarClock className="size-[22px]" strokeWidth={1.75} />
          </span>
          <div className="flex-1">
            <p className="font-semibold">{s?.who ?? 'Home aide from the care agency'}</p>
            <p className="text-[14px] text-ink-mute">
              {s?.label ?? 'Home aide'} · about {plural(s?.expectedMinutes ?? 55, 'minute')}
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-1.5" aria-label={days.map((d) => WEEKDAYS_SHORT[d]).join(', ')}>
          {WEEKDAYS_LETTER.map((d, i) => (
            <span
              key={i}
              className={cx('grid size-9 place-items-center rounded-full text-[13px] font-semibold', days.includes(i) ? 'bg-primary text-white' : 'bg-paper-deep text-ink-mute')}
              aria-hidden
            >
              {d}
            </span>
          ))}
        </div>
        <p className="mt-4 rounded-2xl bg-paper px-4 py-3 text-[15px]">
          Arrives between <strong className="font-semibold">{formatClock(s?.windowStart ?? '09:00')}</strong> and{' '}
          <strong className="font-semibold">{formatClock(s?.windowEnd ?? '09:15')}</strong>
          {weekdays ? ' on weekdays' : ` on ${days.map((d) => WEEKDAYS_SHORT[d]).join(', ')}`}
        </p>
        <p className="mt-3 flex items-center gap-2 text-[14px] text-calm">
          <Check className="size-4" strokeWidth={2.25} aria-hidden /> Homebeat checks the doorbell, the car and the check-in link
        </p>
      </Card>
    </>
  )
}

function StepRules() {
  const parent = useApp().today.household.parentName
  const [on, setOn] = useState({ pkg: true, dark: true, quiet: true })
  const rows = [
    { key: 'pkg' as const, icon: Package, title: 'A package sits outside', body: `After 30 minutes, play a soft chime for ${parent}.` },
    { key: 'dark' as const, icon: MoonStar, title: 'Someone at the door after dark', body: 'Tell you right away, with live view.' },
    { key: 'quiet' as const, icon: CloudMoon, title: 'An unusually quiet day', body: `Suggest you give ${parent} a call.` },
  ]
  return (
    <>
      <p className="text-[16px] text-ink-soft">Choose what’s worth knowing. You can write your own rules in plain English later.</p>
      <Card className="mt-6 divide-y divide-line">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-paper-deep text-primary" aria-hidden>
              <r.icon className="size-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.title}</p>
              <p className="text-[14px] text-ink-mute">{r.body}</p>
            </div>
            <Toggle checked={on[r.key]} onChange={(v) => setOn((o) => ({ ...o, [r.key]: v }))} label={r.title} />
          </div>
        ))}
      </Card>
    </>
  )
}

function StepPeople() {
  const h = useApp().today.household
  const ordered = membersByOrder(h).filter((m) => m.role !== 'viewer')
  const people = ordered.map((m, i) => ({
    name: m.name,
    relation: m.relation,
    when: i === 0 ? 'Told first' : `Told if ${ordered[i - 1].name} doesn’t respond in ${plural(h.escalateAfterMin, 'minute')}`,
  }))
  return (
    <>
      <p className="text-[16px] text-ink-soft">Heads-ups go to one person first, so the family isn’t all woken up at once. Urgent moments reach everyone.</p>
      <Card className="mt-6 p-2">
        <ol>
          {people.length === 0 && <li className="p-3 text-[15px] text-ink-mute">Add family members in Settings to choose who hears first.</li>}
          {people.map((p, i) => (
            <li key={p.name} className="flex items-center gap-3 rounded-2xl p-3">
              <span className="grid size-11 place-items-center rounded-full bg-sage/25 font-serif text-lg text-primary" aria-hidden>
                {p.name[0]}
              </span>
              <div className="flex-1">
                <p className="font-semibold">
                  {i + 1}. {p.name} <span className="font-normal text-ink-mute">· {p.relation}</span>
                </p>
                <p className="text-[14px] text-ink-mute">{p.when}</p>
              </div>
              {i === 0 && <BellRing className="size-5 text-primary" strokeWidth={1.75} aria-hidden />}
            </li>
          ))}
        </ol>
      </Card>
    </>
  )
}

function Tour({ onDone }: { onDone: () => void }) {
  const parentName = useApp().today.household.parentName
  const [step, setStep] = useState(0)
  const [finished, setFinished] = useState(false)
  const navigate = useNavigate()

  if (finished)
    return (
      <div className="flex flex-1 flex-col text-center">
        <span className="mx-auto mb-5 grid size-20 animate-arrive place-items-center rounded-full bg-calm-bg text-calm" aria-hidden>
          <PartyPopper className="size-9" strokeWidth={1.75} />
        </span>
        <h1 className="font-serif text-[32px] leading-tight font-medium" tabIndex={-1} ref={(el) => el?.focus()}>
          You’re all set.
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[16px] text-ink-soft">Homebeat will keep a calm eye on {possessive(parentName)} door.</p>
        <div className="mt-auto flex flex-col gap-3 pt-10">
          <Button size="lg" onClick={() => navigate('/')}>
            Go to Today
          </Button>
        </div>
      </div>
    )

  const finish = () => {
    markDone()
    setFinished(true)
  }
  const Body = [StepVisits, StepRules, StepPeople][step]
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-[14px] font-medium text-ink-mute" aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </p>
        <button
          type="button"
          onClick={() => {
            markDone()
            onDone()
          }}
          className="min-h-11 rounded-full px-3 text-[15px] font-medium text-primary hover:bg-primary-soft"
        >
          Skip
        </button>
      </div>
      <div className="mb-8 grid grid-cols-3 gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-label="Tour progress">
        {STEPS.map((s, i) => (
          <span key={s} className={cx('h-1.5 rounded-full transition-colors duration-300', i <= step ? 'bg-primary' : 'bg-line-strong')} />
        ))}
      </div>
      <div key={step} className="animate-fade-in">
        <h1 className="font-serif text-[30px] leading-tight font-medium">
          {step + 1}. {STEPS[step]}
        </h1>
        <div className="mt-3">
          <Body />
        </div>
      </div>
      <div className="mt-auto flex gap-3 pt-10">
        {step > 0 && (
          <Button size="lg" variant="secondary" icon={ArrowLeft} onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        )}
        <Button size="lg" className="flex-1" onClick={() => (step === STEPS.length - 1 ? finish() : setStep((s) => s + 1))}>
          {step === STEPS.length - 1 ? 'Finish' : 'Next'}
          {step < STEPS.length - 1 && <ArrowRight className="size-[18px]" strokeWidth={1.75} aria-hidden />}
        </Button>
      </div>
    </div>
  )
}

export default function WelcomePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const tour = params.get('tour') === '1'
  useEffect(() => {
    document.title = tour ? 'Quick tour · Homebeat' : 'Account linked · Homebeat'
    return () => {
      document.title = 'Homebeat'
    }
  }, [tour])
  return (
    <Frame>
      {tour ? (
        <Tour onDone={() => navigate('/')} />
      ) : (
        <Linked onTour={() => setParams({ tour: '1' })} />
      )}
    </Frame>
  )
}
