import { BellRing, Car, EyeOff, Link2, Shirt, ShoppingBag, ChevronDown, PiggyBank } from 'lucide-react'
import type { FunnelStats, StageId } from '@shared/types'
import { api } from '@/lib/api'
import { useApp, useAsync } from '@/lib/store'
import { Card, ErrorNote, PageHeader, SectionTitle, Skeleton, cx } from '@/components/ui'
import { STAGE_INFO, formatCost } from '@/components/FunnelTrace'
import { plural, pluralWord, possessive } from '@/lib/format'

export default function HowPage() {
  const { today } = useApp()
  const parent = today.household.parentName
  const { data, error, loading, reload } = useAsync(() => api.funnel(30), [])

  return (
    <div>
      <PageHeader
        eyebrow="How Homebeat watches"
        title="Lots of motion in, a few moments out"
        subtitle={`${possessive(parent)} doorbell sees cars, cats, leaves and people all day. Homebeat looks at each alert in small, cheap steps and only goes further when it has to.`}
      />

      {error ? (
        <ErrorNote error={error} onRetry={reload} />
      ) : loading || !data ? (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-96 rounded-[18px]" />
          <Skeleton className="h-96 rounded-[18px]" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <FunnelCard f={data} />
          <CostCard f={data} />
        </div>
      )}

      <section className="mt-10" aria-labelledby="steps-title">
        <SectionTitle id="steps-title">The four steps, in plain words</SectionTitle>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([0, 1, 2, 3] as StageId[]).map((s) => {
            const info = STAGE_INFO[s]
            const Icon = info.icon
            return (
              <li key={s} className="card p-5">
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full bg-primary text-white" aria-hidden>
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold tracking-wide text-ink-mute uppercase">Step {s + 1}</p>
                    <p className="text-[16px] font-semibold">{info.short}</p>
                  </div>
                </div>
                <p className="text-[15px] leading-relaxed text-ink-soft">{info.plain}</p>
                <p className="mt-3 text-[13px] font-medium text-ink-mute">{stepFootnote(s, data)}</p>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="mt-10 overflow-hidden rounded-[24px] bg-primary p-6 text-white sm:p-8" aria-labelledby="face-title">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <span className="grid size-14 shrink-0 place-items-center rounded-[20px] bg-white/12" aria-hidden>
            <EyeOff className="size-7" strokeWidth={1.75} />
          </span>
          <div className="flex-1">
            <h2 id="face-title" className="font-serif text-[26px] leading-tight font-medium">
              Homebeat never uses face recognition
            </h2>
            <p className="mt-2 max-w-2xl text-[16px] leading-relaxed text-white/85">
              It doesn’t know who anyone is by their face, and it never builds a face database. To tell the home aide from a courier, it looks at simpler, kinder clues:
            </p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                [Shirt, 'Clothing and uniforms', 'Scrubs, a lanyard, a delivery vest'],
                [ShoppingBag, 'What people carry', 'A care bag, a meal bag, a parcel'],
                [Car, 'Expected cars', 'A car that matches an expected visitor, like the aide’s'],
                [Link2, 'Check-in links', 'The aide taps “I’m here” on their own phone'],
              ].map(([Icon, t, d]) => {
                const I = Icon as typeof Car
                return (
                  <li key={t as string} className="flex gap-3 rounded-2xl bg-white/8 p-4">
                    <I className="mt-0.5 size-5 shrink-0 text-[#9FD0B3]" strokeWidth={1.75} aria-hidden />
                    <div>
                      <p className="font-semibold">{t as string}</p>
                      <p className="text-[14px] text-white/75">{d as string}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </section>

      <details className="card group mt-10 p-0">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block font-serif text-[20px] font-medium">For the curious</span>
            <span className="text-[14px] text-ink-mute">The technical details behind the funnel</span>
          </span>
          <ChevronDown className="size-5 text-ink-mute transition-transform group-open:rotate-180" strokeWidth={1.75} aria-hidden />
        </summary>
        <div className="space-y-4 border-t border-line px-5 py-5 text-[15px] leading-relaxed text-ink-soft">
          <p>
            Homebeat follows the tiered funnel from Ring’s Computer Vision guidelines: cheap checks run on every event, and each stage only passes on what it
            can’t settle itself.
          </p>
          <dl className="space-y-3">
            <div>
              <dt className="font-semibold text-ink">Stage 0 · Ring sub_type filter</dt>
              <dd>
                Every Ring motion event carries a <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[13px]">sub_type</code> such as{' '}
                <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[13px]">human</code>, <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[13px]">vehicle</code>,{' '}
                <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[13px]">package_delivery</code> or{' '}
                <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[13px]">animal</code>. Animals stop here, bursts on the same camera are merged, and a passing car
                is ignored unless a visit with a known car is expected. A doorbell press always goes on. Events with no label (like the Ring Developer Playground’s) go on
                to be looked at.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Stage 1 · Object gate</dt>
              <dd>A small on-device detector looks for people and vehicles in the Ring snapshot. An animal on its own, or an empty frame Ring labelled as motion, ends the event with no further cost.</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Stage 2 · Quick match</dt>
              <dd>
                Still on-device, the frame is compared with plain descriptions: a care uniform with a bag, a courier with a parcel, a package left on the step, birds at
                a feeder. Each expected visit can carry a vehicle hint (e.g. “silver hatchback”), so the aide’s car pulling in confirms the visit without calling the
                vision model.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Stage 3 · Vision model</dt>
              <dd>
                Only ambiguous events reach a hosted vision-language model, which returns a short description, visitor type, activity and confidence. Each call
                costs about $0.002; the per-moment trace on every detail page shows the exact time and cost of each stage.
              </dd>
            </div>
          </dl>
          <p>Snapshots are kept only for events that became moments, and are deleted after 30 days.</p>
        </div>
      </details>
    </div>
  )
}

const ROWS: { key: keyof FunnelStats; label: string; hint: string; color: string }[] = [
  { key: 'events', label: 'Ring alerts received', hint: 'Every motion, ring and package alert', color: '#D7CDBF' },
  { key: 'stage1', label: 'Worth a closer look', hint: 'Passed Ring’s own filter', color: '#B9CFC0' },
  { key: 'stage2', label: 'Something really there', hint: 'A person, package or car in view', color: '#9DBDA8' },
  { key: 'stage3', label: 'Needed the vision model', hint: 'Still unclear after the quick checks', color: '#7FA88F' },
  { key: 'moments', label: 'Moments in your timeline', hint: 'Things worth knowing', color: '#3E7C68' },
  { key: 'notified', label: 'Sent to your phone', hint: 'Heads-ups and urgent moments', color: '#1F5C4E' },
]

function formatMs(ms: number) {
  if (ms < 1) return 'under 1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function stepFootnote(s: StageId, f?: FunnelStats) {
  const ms = f?.stageMs?.[s] ?? 0
  const price = s === 3 ? (f?.visionCallUsd ? `About ${formatCost(f.visionCallUsd)} per look` : 'Costs a fraction of a cent') : 'Free, runs on the Homebeat server'
  if (ms <= 0) return price
  return `${s === 3 ? price : 'Free'} · measured ${formatMs(ms)} on this server`
}

function FunnelCard({ f }: { f: FunnelStats }) {
  const max = Math.max(f.events, 1)
  return (
    <Card as="section" className="p-5 sm:p-6" aria-labelledby="funnel-title">
      <h2 id="funnel-title" className="font-serif text-[21px] font-medium">
        The last {plural(f.windowDays, 'day')}
      </h2>
      <p className="mt-1 text-[15px] text-ink-mute">
        {f.events === 0
          ? 'No Ring alerts yet. As the doorbell sees things, they’ll flow through these steps.'
          : `${plural(f.events, 'alert')} became ${plural(f.moments, 'moment')}, and ${f.notified === 0 ? 'none' : f.notified < f.moments ? `only ${f.notified}` : f.notified} needed your phone.`}
      </p>
      {f.sampleEvents > 0 && (
        <p className="mt-1 text-[13px] text-ink-mute">Includes the sample week Homebeat starts with ({plural(f.sampleEvents, 'sample alert')}).</p>
      )}
      <ol className="mt-6 space-y-2.5">
        {ROWS.map((r, i) => {
          const value = f[r.key] as number
          const pct = Math.max(4, (value / max) * 100)
          return (
            <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4">
              <div className="relative flex justify-center">
                <div
                  className="flex h-12 items-center justify-center rounded-xl transition-[width] duration-700"
                  style={{ width: `${pct}%`, background: r.color }}
                  aria-hidden
                >
                  <span className={cx('text-[15px] font-semibold tabular', i >= 4 ? 'text-white' : 'text-ink', pct < 14 && 'sr-only')}>{value.toLocaleString()}</span>
                </div>
              </div>
              <div className="w-[150px] sm:w-[190px]">
                <p className="text-[14px] leading-tight font-semibold text-ink">
                  {pct < 14 && <span className="tabular">{value.toLocaleString()} · </span>}
                  {r.label}
                </p>
                <p className="text-[12px] leading-tight text-ink-mute">{r.hint}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

const money = (v: number) => (v === 0 ? '$0' : formatCost(v))

function CostCard({ f }: { f: FunnelStats }) {
  if (f.naiveCostUsd <= 0 || f.events < 5) return <EarlyCostCard f={f} />
  const saved = f.naiveCostUsd > 0 ? Math.round((1 - f.costUsd / f.naiveCostUsd) * 100) : 0
  const ratio = f.naiveCostUsd > 0 ? (f.costUsd / f.naiveCostUsd) * 100 : 0
  return (
    <Card as="section" className="flex flex-col p-5 sm:p-6" aria-labelledby="cost-title">
      <span className="mb-3 grid size-11 place-items-center rounded-2xl bg-calm-bg text-calm" aria-hidden>
        <PiggyBank className="size-[22px]" strokeWidth={1.75} />
      </span>
      <h2 id="cost-title" className="font-serif text-[21px] font-medium">
        Careful with every cent
      </h2>
      <p className="mt-2 text-[16px] leading-relaxed text-ink-soft">
        Sending every Ring alert to a vision model would have cost <strong className="text-ink">{money(f.naiveCostUsd)}</strong> over the last{' '}
        {plural(f.windowDays, 'day')}. Homebeat spent <strong className="text-ink">{money(f.costUsd)}</strong>.
      </p>
      <div className="mt-6 space-y-4">
        <div>
          <div className="mb-1.5 flex justify-between text-[14px]">
            <span className="text-ink-soft">Every alert to the vision model</span>
            <span className="font-semibold tabular">{money(f.naiveCostUsd)}</span>
          </div>
          <div className="h-4 rounded-full bg-line-strong" aria-hidden />
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-[14px]">
            <span className="text-ink-soft">Homebeat’s step-by-step way</span>
            <span className="font-semibold text-primary tabular">{money(f.costUsd)}</span>
          </div>
          <div className="h-4 rounded-full bg-paper-deep" aria-hidden>
            <div className="h-4 rounded-full bg-primary" style={{ width: `${Math.max(2, ratio)}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-auto pt-6">
        <p className="rounded-2xl bg-calm-bg px-4 py-3 text-[15px] font-medium text-calm">
          {saved >= 100 ? (
            <>No vision-model looks were needed yet, and far fewer pings for you.</>
          ) : (
            <>
              <span className="font-serif text-[22px] tabular">{saved}%</span> less spent, and far fewer pings for you.
            </>
          )}
        </p>
        <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-mute">
          <BellRing className="size-4" strokeWidth={1.75} aria-hidden />
          {f.stage3.toLocaleString()} of {plural(f.events, 'alert')} needed the vision model.
        </p>
      </div>
    </Card>
  )
}

/** Honest version for a brand-new home: too few alerts for a savings percentage to mean anything. */
function EarlyCostCard({ f }: { f: FunnelStats }) {
  const call = f.visionCallUsd
  return (
    <Card as="section" className="flex flex-col p-5 sm:p-6" aria-labelledby="cost-title">
      <span className="mb-3 grid size-11 place-items-center rounded-2xl bg-calm-bg text-calm" aria-hidden>
        <PiggyBank className="size-[22px]" strokeWidth={1.75} />
      </span>
      <h2 id="cost-title" className="font-serif text-[21px] font-medium">
        Careful with every cent
      </h2>
      <p className="mt-2 text-[16px] leading-relaxed text-ink-soft">
        {f.events === 0 ? 'Homebeat hasn’t seen any alerts yet' : `Homebeat has only seen ${plural(f.events, 'alert')} so far`}, so it’s too early to say how much it saves. Here’s
        the math it follows for every alert:
      </p>
      <dl className="mt-5 divide-y divide-line rounded-2xl bg-paper">
        {[
          ['Steps 1–3 (Ring filter, object check, quick match)', 'free'],
          ['Step 4, one look by the vision model', call > 0 ? formatCost(call) : 'a fraction of a cent'],
          ['Sending every alert to the vision model', call > 0 ? `${formatCost(call)} × every alert` : 'every alert costs'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-3 text-[14px]">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="shrink-0 font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-auto pt-5 text-[14px] text-ink-mute">
        So far {f.stage3 === 0 ? 'no alert has' : `${plural(f.stage3, 'alert')} ${pluralWord(f.stage3, 'has', 'have')}`} needed the vision model
        {f.costUsd > 0 ? `, ${formatCost(f.costUsd)} in total` : ''}. In a typical home most alerts stop at step 1 or 2.
      </p>
    </Card>
  )
}
