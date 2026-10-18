// Plain-English care rules -> one of six structured templates the engine evaluates deterministically.
// The model only translates; it never decides at runtime. A regex fallback keeps rules working offline.
import { z } from 'zod'
import type { CompiledRule, Rule, RuleTemplate, Schedule } from '../../../shared/types.ts'
import { askJson, aiEnabled } from '../ai/provider.ts'
import { uid } from '../db.ts'
import { household, rules, schedules } from '../store.ts'

const Action = z.union([
  z.object({ type: z.literal('notify'), who: z.enum(['primary', 'family']) }),
  z.object({ type: z.literal('chime'), slot: z.enum(['ring-appstore-event-1', 'ring-appstore-event-2']) }),
  z.object({ type: z.literal('live_view') }),
  z.object({ type: z.literal('escalate'), afterMin: z.number().min(1).max(240) }),
])

const Compiled = z.object({
  template: z.enum(['expected_visit', 'package_waiting', 'quiet_hours', 'no_activity', 'unknown_vehicle', 'custom_watch']),
  summary: z.string().min(5).max(240),
  params: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.number())])),
  actions: z.array(Action).min(1),
  severity: z.enum(['calm', 'note', 'heads_up', 'urgent']),
})

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/

function validate(c: CompiledRule): CompiledRule {
  const p = c.params
  const need = (key: string, ok: (v: unknown) => boolean) => {
    if (!ok(p[key])) throw new Error(`Rule is missing a valid "${key}"`)
  }
  const num = (v: unknown) => typeof v === 'number' && v > 0
  const time = (v: unknown) => typeof v === 'string' && HHMM.test(v)
  switch (c.template) {
    case 'expected_visit':
      need('who', (v) => typeof v === 'string' && v.length > 0)
      need('days', (v) => Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      need('windowStart', time)
      need('windowEnd', time)
      break
    case 'package_waiting':
      need('minutes', num)
      break
    case 'quiet_hours':
      need('start', time)
      need('end', time)
      break
    case 'no_activity':
      need('hours', num)
      break
    case 'unknown_vehicle':
      need('minutes', num)
      break
    case 'custom_watch':
      need('question', (v) => typeof v === 'string' && v.length > 5)
      break
  }
  return c
}

const SYSTEM = `You translate a family member's plain-English instruction for Homebeat (a care app that watches an older parent's Ring doorbell/cameras) into ONE JSON rule. Templates and params:
- expected_visit: a helper who should come regularly. params {who: "Maria (BrightCare)", label: "Home aide", visitorType: "care_worker"|"delivery"|"family"|"service", days: [0-6, 0=Sunday], windowStart: "HH:MM", windowEnd: "HH:MM", graceMin: number, expectedMinutes: number, vehicleHint?: "silver hatchback"}
- package_waiting: a package left outside too long. params {minutes}
- quiet_hours: any door activity in a time range. params {start: "HH:MM", end: "HH:MM"}
- no_activity: nobody in or out for too long during the day. params {hours, from: "HH:MM", to: "HH:MM"}
- unknown_vehicle: an unfamiliar vehicle parked too long. params {minutes}
- custom_watch: any other visual condition. params {question: a yes/no question about a single camera frame}
Actions: {"type":"notify","who":"primary"|"family"}, {"type":"chime","slot":"ring-appstore-event-1"} (plays a soft tone on the parent's Ring Chime, good for nudging the parent), {"type":"live_view"}, {"type":"escalate","afterMin":n}.
severity: "note" for FYI, "heads_up" for things to act on soon, "urgent" for safety.
summary: one friendly sentence restating the rule, using the parent's name.
Reply with only the JSON object {template, summary, params, actions, severity}.`

export async function compileRule(english: string): Promise<CompiledRule> {
  const parent = household.get().parentName
  if (aiEnabled()) {
    try {
      const raw = await askJson<CompiledRule>({ system: SYSTEM, prompt: `Parent's name: ${parent}.\nInstruction: ${english}`, model: 'text', maxTokens: 400 })
      return validate(Compiled.parse(raw) as CompiledRule)
    } catch (err) {
      console.warn('[rules] model compile failed, using fallback:', (err as Error).message)
    }
  }
  return validate(fallbackCompile(english, parent))
}

const DAY_WORDS: [RegExp, number[]][] = [
  [/weekdays?/i, [1, 2, 3, 4, 5]],
  [/weekends?/i, [0, 6]],
  [/every ?day|daily/i, [0, 1, 2, 3, 4, 5, 6]],
]
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function times(text: string): string[] {
  return [...text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi)]
    .filter((m) => m[3] || m[2])
    .map((m) => {
      const suffix = (m[3] ?? '').toLowerCase()
      const h = suffix ? (Number(m[1]) % 12) + (suffix === 'pm' ? 12 : 0) : Number(m[1])
      return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`
    })
}

const minutesIn = (text: string, fallback: number) => {
  const m = text.match(/(\d+)\s*(minutes?|mins?|hours?|hrs?|h)\b/i)
  if (!m) return fallback
  return /^h/i.test(m[2]) ? Number(m[1]) * 60 : Number(m[1])
}

export function fallbackCompile(english: string, parent: string): CompiledRule {
  const t = english.toLowerCase()
  const notify = { type: 'notify' as const, who: 'primary' as const }
  if (/package|parcel|delivery|box/.test(t)) {
    const minutes = minutesIn(t, 30)
    return {
      template: 'package_waiting',
      summary: `If a package sits outside ${parent}'s door for more than ${minutes} min, play a soft chime inside and tell you.`,
      params: { minutes },
      actions: [notify, { type: 'chime', slot: 'ring-appstore-event-1' }],
      severity: 'heads_up',
    }
  }
  if (/car|vehicle|van|truck|park/.test(t)) {
    const minutes = minutesIn(t, 15)
    return { template: 'unknown_vehicle', summary: `If an unfamiliar vehicle stays parked at ${parent}'s for more than ${minutes} min, tell you.`, params: { minutes }, actions: [notify], severity: 'heads_up' }
  }
  if (/no one|nobody|hasn't|has not|no activity|quiet|leave the house|left the house/.test(t) && /hour|hrs?\b/.test(t)) {
    const hours = Math.max(1, Math.round(minutesIn(t, 360) / 60))
    return { template: 'no_activity', summary: `If no one comes or goes at ${parent}'s for ${hours} hours during the day, suggest a check-in call.`, params: { hours, from: '08:00', to: '20:00' }, actions: [notify], severity: 'note' }
  }
  const [a, b] = times(t)
  if (/(aide|nurse|carer|caregiver|cleaner|visit|comes|arrive)/.test(t) && a) {
    const days = DAY_WORDS.find(([re]) => re.test(t))?.[1] ?? DAYS.map((d, i) => (t.includes(d) ? i : -1)).filter((i) => i >= 0)
    const who = english.match(/\b([A-Z][a-z]+)\b/)?.[1] ?? 'Helper'
    const plus15 = Math.min(23 * 60 + 59, Number(a.slice(0, 2)) * 60 + Number(a.slice(3)) + 15)
    const end = b ?? `${String(Math.floor(plus15 / 60)).padStart(2, '0')}:${String(plus15 % 60).padStart(2, '0')}`
    return {
      template: 'expected_visit',
      summary: `Expect ${who} at ${parent}'s between ${a} and ${end}, and tell you if they're late or don't come.`,
      params: { who, label: 'Expected visit', visitorType: 'care_worker', days: days.length ? days : [1, 2, 3, 4, 5], windowStart: a, windowEnd: end, graceMin: 30, expectedMinutes: 60 },
      actions: [notify],
      severity: 'heads_up',
    }
  }
  if (/(night|after dark|late|anyone|anybody|someone)/.test(t) && a && b) {
    return {
      template: 'quiet_hours',
      summary: `Any activity at ${parent}'s door between ${a} and ${b} is urgent: tell you right away with live view.`,
      params: { start: a, end: b },
      actions: [notify, { type: 'live_view' }, { type: 'escalate', afterMin: 5 }],
      severity: 'urgent',
    }
  }
  return {
    template: 'custom_watch',
    summary: `Homebeat will ask its vision model about each visitor: "${english.replace(/^(tell|let) me (if|when) /i, '').replace(/\.$/, '')}?"`,
    params: { question: english.replace(/^(tell|let) me (know )?(if|when) /i, 'Is ').replace(/\.$/, '?') },
    actions: [notify],
    severity: 'note',
  }
}

export function saveRule(english: string, compiled: CompiledRule): Rule {
  const rule: Rule = { id: uid('ru'), english, compiled: validate(compiled), enabled: true, createdAt: Date.now(), fireCount: 0 }
  rules.put(rule)
  if (compiled.template === 'expected_visit') syncSchedule(rule)
  return rule
}

// expected_visit rules own a Schedule so the visit machinery picks them up.
export function syncSchedule(rule: Rule) {
  const p = rule.compiled.params
  const schedule: Schedule = {
    id: `s_${rule.id}`,
    label: String(p.label ?? 'Expected visit'),
    who: String(p.who),
    visitorType: (p.visitorType as Schedule['visitorType']) ?? 'care_worker',
    days: p.days as number[],
    windowStart: String(p.windowStart),
    windowEnd: String(p.windowEnd),
    graceMin: Number(p.graceMin ?? 30),
    expectedMinutes: Number(p.expectedMinutes ?? 60),
    vehicleHint: p.vehicleHint ? String(p.vehicleHint) : undefined,
    checkinCode: Math.random().toString(36).slice(2, 8),
    active: rule.enabled,
  }
  schedules.put(schedule)
}

export function activeRules(template?: RuleTemplate): Rule[] {
  return rules.all().filter((r) => r.enabled && (!template || r.compiled.template === template))
}

export function ruleFired(rule: Rule) {
  rules.put({ ...rule, fireCount: rule.fireCount + 1, lastFiredAt: Date.now() })
}

export function quietHours() {
  const rule = activeRules('quiet_hours')[0]
  return rule ? { start: String(rule.compiled.params.start), end: String(rule.compiled.params.end), rule } : { ...household.get().quietHours, rule: undefined }
}

export function packageMinutes() {
  const rule = activeRules('package_waiting')[0]
  return { minutes: rule ? Number(rule.compiled.params.minutes) : 45, rule }
}
