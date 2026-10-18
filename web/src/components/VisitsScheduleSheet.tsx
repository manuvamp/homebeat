import { useEffect, useId, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Schedule, VisitorType } from '@shared/types'
import { api } from '@/lib/api'
import { WEEKDAYS_SHORT } from '@/lib/time'
import { Button, Field, Sheet, Toggle, cx, friendlyError, inputCls } from './ui'

const VISITOR_TYPES: { value: VisitorType; label: string }[] = [
  { value: 'care_worker', label: 'Care worker (aide, nurse, carer)' },
  { value: 'delivery', label: 'Delivery (meals, pharmacy, groceries)' },
  { value: 'service', label: 'Service (cleaner, gardener)' },
  { value: 'family', label: 'Family or friend' },
  { value: 'unknown', label: 'Someone else' },
]

export type ScheduleDraft = Omit<Schedule, 'id'> & { id?: string }

export const emptySchedule = (): ScheduleDraft => ({
  label: '',
  who: '',
  visitorType: 'care_worker',
  days: [1, 2, 3, 4, 5],
  windowStart: '10:00',
  windowEnd: '10:15',
  graceMin: 30,
  expectedMinutes: 45,
  vehicleHint: '',
  active: true,
})

export function VisitsScheduleSheet({
  open,
  initial,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean
  initial: ScheduleDraft | null
  onClose: () => void
  onSaved: (s: Schedule) => void
  onDeleted: (id: string) => void
}) {
  const [d, setD] = useState<ScheduleDraft>(initial ?? emptySchedule())
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const uid = useId()

  useEffect(() => {
    if (open) {
      setD(initial ?? emptySchedule())
      setError(null)
      setConfirmDelete(false)
    }
  }, [open, initial])

  const set = <K extends keyof ScheduleDraft>(k: K, v: ScheduleDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const toggleDay = (i: number) => set('days', d.days.includes(i) ? d.days.filter((x) => x !== i) : [...d.days, i].sort())

  const invalid = !d.who.trim() ? 'Add who is coming.' : !d.days.length ? 'Pick at least one day.' : d.windowEnd <= d.windowStart ? 'The on-time limit should be after the earliest arrival.' : null

  async function save() {
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy('save')
    setError(null)
    try {
      const body = { ...d, label: d.label.trim() || 'Visit', who: d.who.trim(), vehicleHint: d.vehicleHint?.trim() || undefined }
      const saved = d.id ? await api.updateSchedule(body as Schedule) : await api.createSchedule(body)
      onSaved(saved)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!d.id) return
    setBusy('delete')
    try {
      await api.deleteSchedule(d.id)
      onDeleted(d.id)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={d.id ? 'Edit expected visit' : 'Add an expected visit'}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {d.id &&
            (confirmDelete ? (
              <Button variant="danger" icon={Trash2} loading={busy === 'delete'} onClick={remove}>
                Yes, remove it
              </Button>
            ) : (
              <Button variant="ghost" className="text-urgent hover:bg-urgent-bg" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Remove
              </Button>
            ))}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy === 'save'}>
              {d.id ? 'Save changes' : 'Add visit'}
            </Button>
          </div>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="Who is coming?" htmlFor={`${uid}-who`} hint="A name and, if it helps, the agency. For example “Maria (BrightCare)”.">
          <input id={`${uid}-who`} className={inputCls} value={d.who} onChange={(e) => set('who', e.target.value)} placeholder="Maria (BrightCare)" autoComplete="off" />
        </Field>
        <Field label="What kind of visit?" htmlFor={`${uid}-label`}>
          <input id={`${uid}-label`} className={inputCls} value={d.label} onChange={(e) => set('label', e.target.value)} placeholder="Home aide" autoComplete="off" />
        </Field>
        <Field label="They are a…" htmlFor={`${uid}-type`}>
          <select id={`${uid}-type`} className={inputCls} value={d.visitorType} onChange={(e) => set('visitorType', e.target.value as VisitorType)}>
            {VISITOR_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="mb-4">
          <legend className="mb-1.5 text-[15px] font-medium text-ink">Which days?</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS_SHORT.map((name, i) => {
              const on = d.days.includes(i)
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(i)}
                  className={cx(
                    'min-h-11 min-w-[48px] rounded-full px-3 text-[15px] font-medium transition-colors',
                    on ? 'bg-primary text-white' : 'bg-white text-ink-soft ring-1 ring-line-strong hover:bg-paper-deep',
                  )}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Arrives from" htmlFor={`${uid}-ws`}>
            <input id={`${uid}-ws`} type="time" className={inputCls} value={d.windowStart} onChange={(e) => set('windowStart', e.target.value)} />
          </Field>
          <Field label="On time until" htmlFor={`${uid}-we`}>
            <input id={`${uid}-we`} type="time" className={inputCls} value={d.windowEnd} onChange={(e) => set('windowEnd', e.target.value)} />
          </Field>
          <Field label="Call it missed after" htmlFor={`${uid}-grace`} hint="Minutes past the on-time limit.">
            <input id={`${uid}-grace`} type="number" min={5} max={240} step={5} className={inputCls} value={d.graceMin} onChange={(e) => set('graceMin', Number(e.target.value))} />
          </Field>
          <Field label="Usual visit length" htmlFor={`${uid}-len`} hint="In minutes.">
            <input id={`${uid}-len`} type="number" min={1} max={600} step={5} className={inputCls} value={d.expectedMinutes} onChange={(e) => set('expectedMinutes', Number(e.target.value))} />
          </Field>
        </div>

        <Field label="Their car (optional)" htmlFor={`${uid}-car`} hint="Helps Homebeat recognise the visit from the Driveway camera. Just the car, never a face.">
          <input id={`${uid}-car`} className={inputCls} value={d.vehicleHint ?? ''} onChange={(e) => set('vehicleHint', e.target.value)} placeholder="silver hatchback" autoComplete="off" />
        </Field>

        <div className="flex items-center justify-between gap-4 rounded-2xl bg-white p-4 ring-1 ring-line">
          <div>
            <p className="text-[15px] font-medium" id={`${uid}-active`}>
              Watch for this visit
            </p>
            <p className="text-sm text-ink-mute">Turn off while they’re on holiday.</p>
          </div>
          <Toggle checked={d.active} onChange={(v) => set('active', v)} label="Watch for this visit" />
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-urgent-bg px-4 py-3 text-[15px] text-urgent">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  )
}
