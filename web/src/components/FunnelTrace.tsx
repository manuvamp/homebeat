import { Brain, Car, Filter, ScanSearch, CheckCircle2, MinusCircle, XCircle, type LucideIcon } from 'lucide-react'
import type { Analysis, StageId, StageResult } from '@shared/types'
import { cx } from './ui'

export const STAGE_INFO: Record<StageId, { short: string; plain: string; icon: LucideIcon }> = {
  0: { short: 'Ring filter', plain: 'Ring already labels what it saw. Homebeat ignores the kinds of motion that never matter.', icon: Filter },
  1: { short: 'Object check', plain: 'A small on-device model checks the snapshot for a person, a package or a car.', icon: ScanSearch },
  2: { short: 'Quick match', plain: 'Still on-device: the frame is compared with plain descriptions, like a care uniform, a package on the step, the home aide’s car or birds at a feeder.', icon: Car },
  3: { short: 'Vision model', plain: 'Only when it’s still unclear does a vision model describe the scene in plain words.', icon: Brain },
}

export function formatCost(usd: number) {
  if (usd === 0) return 'free'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
function formatMs(ms: number, ran = true) {
  if (!ran) return '–'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

const noFrame = (s: StageResult) => /^no (frame|snapshot|image)/i.test(s.summary)

/** Plain-English summary for a stage, tidying up terse server summaries. */
export function stageSummary(s: StageResult) {
  const raw = s.summary.trim()
  if (noFrame(s)) return 'Ring didn’t have a snapshot for this alert, so this step couldn’t look.'
  if (!s.ran && (!raw || /^(not needed|skipped)\.?$/i.test(raw))) {
    return s.stage === 2 ? 'No car to compare, so this step wasn’t needed.' : 'Earlier steps were sure enough, so this one wasn’t needed.'
  }
  if (s.stage === 0) {
    // "human -> process" / "package_delivery -> process": Ring's own label, in plain words.
    const m = raw.match(/^([\w ]+?)\s*(?:->|→)\s*(\w+)/)
    if (m) {
      const what = SUBTYPE[m[1].trim()] ?? m[1].trim().replace(/_/g, ' ')
      const next = /process|pass|keep/i.test(m[2]) ? 'worth a closer look' : 'not worth a look'
      return `Ring saw ${what}, ${next}`
    }
  }
  return raw.replace(/->/g, '→').replace(/\b([a-z]+)_([a-z]+)\b/g, '$1 $2')
}

const SUBTYPE: Record<string, string> = {
  human: 'a person',
  motion: 'motion',
  ding: 'a doorbell press',
  package_delivery: 'a package delivery',
  package_pickup: 'a package pickup',
  vehicle: 'a vehicle',
  animal: 'an animal',
  other_motion: 'other motion',
}

function StageState({ s }: { s: StageResult }) {
  if (!s.ran)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-mute">
        <MinusCircle className="size-3.5" strokeWidth={2} aria-hidden /> {noFrame(s) ? 'No snapshot' : 'Not needed'}
      </span>
    )
  if (s.passed)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-calm">
        <CheckCircle2 className="size-3.5" strokeWidth={2} aria-hidden /> Ran
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-note">
      <XCircle className="size-3.5" strokeWidth={2} aria-hidden /> Stopped here
    </span>
  )
}

/** Horizontal stepper of the four-stage funnel for one moment (vertical on narrow screens). */
export function FunnelTrace({ analysis }: { analysis: Analysis }) {
  const stages = [...analysis.stages].sort((a, b) => a.stage - b.stage)
  return (
    <div>
      <ol className="grid gap-3 md:grid-cols-4 md:gap-0" aria-label="How Homebeat looked at this">
        {stages.map((s, i) => {
          const info = STAGE_INFO[s.stage]
          const Icon = info.icon
          return (
            <li key={s.stage} className="relative md:px-1.5 first:md:pl-0 last:md:pr-0">
              {i < stages.length - 1 && (
                <span
                  className={cx('absolute top-[22px] left-[calc(50%+26px)] hidden h-0.5 w-[calc(100%-52px)] md:block', s.ran ? 'bg-sage' : 'bg-line-strong')}
                  aria-hidden
                />
              )}
              <div className={cx('flex gap-3 md:flex-col md:items-center md:text-center', !s.ran && 'opacity-70')}>
                <span
                  className={cx(
                    'relative z-10 grid size-11 shrink-0 place-items-center rounded-full ring-4 ring-white',
                    s.ran ? 'bg-primary text-white' : 'border-2 border-dashed border-line-strong bg-paper text-ink-mute',
                  )}
                  aria-hidden
                >
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <div className={cx('min-w-0 flex-1 rounded-2xl p-3 md:mt-3 md:w-full', s.ran ? 'bg-paper' : 'bg-paper/60')}>
                  <p className="text-[12px] font-semibold tracking-wide text-ink-mute uppercase">Stage {s.stage}</p>
                  <p className="text-[15px] font-semibold text-ink">{info.short}</p>
                  <div className="mt-1"><StageState s={s} /></div>
                  <p className="mt-1.5 text-[14px] leading-snug break-words text-ink-soft">{stageSummary(s)}</p>
                  <p className="mt-2 flex gap-3 text-[12px] font-medium text-ink-mute tabular md:justify-center">
                    <span>{formatMs(s.ms, s.ran)}</span>
                    <span>{s.ran ? formatCost(s.costUsd) : '–'}</span>
                  </p>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-4 text-[14px] text-ink-mute tabular">
        Time spent looking {formatMs(stages.reduce((t, s) => t + (s.ran ? s.ms : 0), 0))} · cost {formatCost(analysis.totalCostUsd)}
        {analysis.stages.some((s) => !s.ran && !noFrame(s)) && ' · steps marked “not needed” were skipped to save time and money'}
      </p>
    </div>
  )
}
