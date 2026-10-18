import { useId, useRef, useState } from 'react'
import { BellRing, Check, Pencil, Sparkles, Trash2, Users, UserRound, Video, Timer, Wand2, ListChecks } from 'lucide-react'
import type { CompiledRule, Household, Rule, RuleAction } from '@shared/types'
import { api } from '@/lib/api'
import { useApp, useAsync } from '@/lib/store'
import { RULE_TEMPLATE, paramPill } from '@/lib/meta'
import { relativeTime } from '@/lib/time'
import { Button, Card, EmptyState, ErrorNote, PageHeader, Pill, SectionTitle, SeverityBadge, Sheet, Skeleton, Toggle, cx, friendlyError } from '@/components/ui'

const EXAMPLES = [
  'Tell me if a package sits outside more than 30 minutes',
  'Let me know about anyone at the door after 9 at night',
  'If nobody comes or goes for 6 hours during the day, nudge me',
  'The nurse comes Tuesdays and Thursdays at 2pm',
  'Tell me if an unfamiliar car stays in the driveway over 20 minutes',
  'Tell me if someone in a high-visibility vest comes to the door',
]

function actionChip(a: RuleAction, h: Household): { label: string; icon: typeof BellRing } {
  const primary = h.members.find((m) => m.role === 'primary')?.name ?? 'you'
  switch (a.type) {
    case 'notify':
      return a.who === 'primary' ? { label: `Tell ${primary}`, icon: UserRound } : { label: 'Tell the family', icon: Users }
    case 'chime':
      return { label: `Soft chime in ${h.homeName}`, icon: BellRing }
    case 'live_view':
      return { label: 'Offer live view', icon: Video }
    case 'escalate':
      return { label: `Escalate after ${a.afterMin} min`, icon: Timer }
  }
}

function RuleBody({ compiled, household, big }: { compiled: CompiledRule; household: Household; big?: boolean }) {
  const t = RULE_TEMPLATE[compiled.template]
  return (
    <div className="flex gap-4">
      <span className={cx('grid shrink-0 place-items-center rounded-2xl', t.tint, big ? 'size-14' : 'size-11')} aria-hidden>
        <t.icon className={big ? 'size-7' : 'size-[22px]'} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-semibold tracking-wide text-ink-mute uppercase">{t.label}</p>
          {big && <SeverityBadge severity={compiled.severity} />}
        </div>
        <p className={cx('mt-1 font-serif leading-snug text-ink', big ? 'text-[22px]' : 'text-[18px]')}>{compiled.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Details">
          {Object.entries(compiled.params).map(([k, v]) => (
            <Pill key={k} className="bg-paper-deep text-ink-soft">
              {paramPill(k, v)}
            </Pill>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="What Homebeat will do">
          {compiled.actions.map((a, i) => {
            const c = actionChip(a, household)
            return (
              <Pill key={i} icon={c.icon} className="bg-primary-soft text-primary">
                {c.label}
              </Pill>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Composer({ onSaved }: { onSaved: (r: Rule) => void }) {
  const { today } = useApp()
  const [text, setText] = useState('')
  const [compiled, setCompiled] = useState<{ english: string; rule: CompiledRule } | null>(null)
  const [state, setState] = useState<'idle' | 'compiling' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const id = useId()

  async function compile(english = text) {
    const e = english.trim()
    if (!e) {
      ref.current?.focus()
      return
    }
    setState('compiling')
    setError(null)
    setJustSaved(false)
    try {
      const rule = await api.compileRule(e)
      setCompiled({ english: e, rule })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setState('idle')
    }
  }

  async function save() {
    if (!compiled) return
    setState('saving')
    try {
      const r = await api.createRule(compiled.english, compiled.rule)
      onSaved(r)
      setCompiled(null)
      setText('')
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 4000)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setState('idle')
    }
  }

  function edit() {
    setText(compiled?.english ?? text)
    setCompiled(null)
    requestAnimationFrame(() => ref.current?.focus())
  }

  return (
    <Card as="section" className="overflow-hidden" aria-labelledby={`${id}-title`}>
      <div className="p-5 sm:p-6">
        <h2 id={`${id}-title`} className="font-serif text-[24px] font-medium">
          What should Homebeat look out for?
        </h2>
        <p className="mt-1 text-[15px] text-ink-soft">Write it the way you’d say it to a neighbour. Homebeat turns it into a rule you can check before saving.</p>

        {!compiled && (
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault()
              void compile()
            }}
          >
            <label htmlFor={`${id}-text`} className="sr-only">
              Your rule, in plain English
            </label>
            <textarea
              id={`${id}-text`}
              ref={ref}
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void compile()
              }}
              placeholder="Tell me if a package sits outside more than 30 minutes"
              className="w-full resize-none rounded-2xl border border-line-strong bg-paper/60 px-4 py-3.5 text-[17px] leading-relaxed text-ink placeholder:text-ink-mute/70 focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/15"
              disabled={state === 'compiling'}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-ink-mute">Try one of these, or write your own:</p>
              <Button type="submit" icon={Wand2} loading={state === 'compiling'} disabled={!text.trim()}>
                {state === 'compiling' ? 'Reading your rule…' : 'Turn into a rule'}
              </Button>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Example rules">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    disabled={state === 'compiling'}
                    onClick={() => {
                      setText(ex)
                      void compile(ex)
                    }}
                    className="min-h-10 rounded-full bg-paper-deep px-3.5 py-2 text-left text-[14px] text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary disabled:opacity-50"
                  >
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </form>
        )}

        {state === 'compiling' && (
          <div className="mt-5 rounded-[20px] border border-line bg-paper p-5" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-[15px] font-medium text-primary">
              <Sparkles className="size-[18px] animate-pulse" strokeWidth={1.75} aria-hidden />
              Reading your rule…
            </p>
            <div className="mt-4 flex gap-4" aria-hidden>
              <Skeleton className="size-11 shrink-0 rounded-2xl" />
              <div className="flex-1 space-y-2.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-7 w-24 rounded-full" />
                  <Skeleton className="h-7 w-28 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        )}

        {compiled && state !== 'compiling' && (
          <div className="mt-5 animate-arrive" aria-live="polite">
            <p className="mb-2 text-[14px] text-ink-mute">
              You wrote: <span className="text-ink-soft italic">“{compiled.english}”</span>
            </p>
            <div className="rounded-[20px] border-2 border-primary/20 bg-white p-5">
              <p className="mb-3 text-[13px] font-semibold text-primary">Here’s how Homebeat understood it</p>
              <RuleBody compiled={compiled.rule} household={today.household} big />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button icon={Check} onClick={save} loading={state === 'saving'}>
                Save rule
              </Button>
              <Button variant="secondary" icon={Pencil} onClick={edit}>
                Edit
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-urgent-bg px-4 py-3 text-[15px] text-urgent">
            {error}
          </p>
        )}
        {justSaved && (
          <p role="status" className="mt-4 flex items-center gap-2 rounded-2xl bg-calm-bg px-4 py-3 text-[15px] font-medium text-calm">
            <Check className="size-[18px]" strokeWidth={2} aria-hidden />
            Saved. Homebeat is watching for it now.
          </p>
        )}
      </div>
    </Card>
  )
}

function RuleRow({ r, household, onToggle, onDelete }: { r: Rule; household: Household; onToggle: (v: boolean) => void; onDelete: () => void }) {
  const descId = useId()
  return (
    <Card as="li" className={cx('p-5 transition-opacity', !r.enabled && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1" id={descId}>
          <RuleBody compiled={r.compiled} household={household} />
        </div>
        <Toggle checked={r.enabled} onChange={onToggle} label={`${r.enabled ? 'Turn off' : 'Turn on'}: ${r.compiled.summary}`} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="text-[13px] text-ink-mute">
          {r.enabled ? '' : 'Paused · '}
          {r.fireCount === 0 ? 'Hasn’t been needed yet' : `Noticed ${r.fireCount === 1 ? 'once' : `${r.fireCount} times`}`}
          {r.lastFiredAt && ` · last ${relativeTime(r.lastFiredAt)}`}
        </p>
        <Button variant="ghost" size="sm" icon={Trash2} className="text-ink-mute hover:bg-urgent-bg hover:text-urgent" onClick={onDelete} aria-label={`Delete rule: ${r.english}`}>
          Delete
        </Button>
      </div>
    </Card>
  )
}

export default function RulesPage() {
  const { today, pushToast } = useApp()
  const rulesQ = useAsync(() => api.rules(), [])
  const [confirm, setConfirm] = useState<Rule | null>(null)
  const [deleting, setDeleting] = useState(false)
  const rules = rulesQ.data ?? []

  async function toggle(r: Rule, enabled: boolean) {
    const prev = rules
    rulesQ.setData(rules.map((x) => (x.id === r.id ? { ...x, enabled } : x)))
    try {
      await api.setRuleEnabled(r.id, enabled)
    } catch (e) {
      rulesQ.setData(prev)
      pushToast({ tone: 'heads_up', title: 'Couldn’t change that rule', body: friendlyError(e) })
    }
  }

  async function remove() {
    if (!confirm) return
    setDeleting(true)
    try {
      await api.deleteRule(confirm.id)
      rulesQ.setData(rules.filter((x) => x.id !== confirm.id))
      setConfirm(null)
    } catch (e) {
      pushToast({ tone: 'heads_up', title: 'Couldn’t delete that rule', body: friendlyError(e) })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader title="Care rules" subtitle={`Tell Homebeat what matters at ${today.household.homeName}, in your own words.`} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-24">
          <Composer onSaved={(r) => rulesQ.setData([r, ...rules])} />
        </div>
        <section aria-labelledby="rules-title">
          <SectionTitle id="rules-title">{rules.length ? `Your rules (${rules.filter((r) => r.enabled).length} on)` : 'Your rules'}</SectionTitle>
          {rulesQ.error ? (
            <ErrorNote error={rulesQ.error} onRetry={rulesQ.reload} />
          ) : !rulesQ.data ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading rules">
              <Skeleton className="h-40 rounded-[18px]" />
              <Skeleton className="h-40 rounded-[18px]" />
            </div>
          ) : rules.length === 0 ? (
            <Card>
              <EmptyState icon={ListChecks} title="No rules yet" body="Pick an example on the left, or write your own. You can turn rules off any time." />
            </Card>
          ) : (
            <ul className="space-y-3">
              {rules.map((r) => (
                <RuleRow key={r.id} r={r} household={today.household} onToggle={(v) => toggle(r, v)} onDelete={() => setConfirm(r)} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <Sheet
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this rule?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button variant="urgent" icon={Trash2} loading={deleting} onClick={remove}>
              Delete rule
            </Button>
          </div>
        }
      >
        <p className="text-[16px] text-ink-soft">
          Homebeat will stop watching for <span className="font-medium text-ink">“{confirm?.english}”</span>. Past moments stay in the timeline. If you only need a break, turn it off instead.
        </p>
      </Sheet>
    </div>
  )
}

