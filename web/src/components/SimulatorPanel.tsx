import { useState } from 'react'
import { BellRing, Car, Footprints, FlaskConical, HeartHandshake, LogOut, MoonStar, Package, PackageCheck, Soup, type LucideIcon } from 'lucide-react'
import { api, getMode, type SimAction } from '@/lib/api'
import { useApp, useAsync } from '@/lib/store'
import { firstName } from '@/lib/format'
import { Button, Sheet, cx, friendlyError } from './ui'

/** True when the real backend runs the offline simulator (the only mode where /api/sim/event works). */
export function useSimulatorAvailable() {
  const { today } = useApp()
  return getMode().kind === 'real' && today.household.ringMode === 'offline_sim'
}

export function SimulatorPanel({ compact }: { compact?: boolean }) {
  const { today, pushToast } = useApp()
  const parent = today.household.parentName
  const schedules = useAsync(() => api.schedules(), [])
  const aide = schedules.data?.find((s) => s.visitorType === 'care_worker' && s.active)
  const aideName = aide ? firstName(aide.who) : 'The aide'
  const [busy, setBusy] = useState<SimAction | null>(null)

  const actions: { action: SimAction; label: string; icon: LucideIcon }[] = [
    { action: 'aide_arrives', label: `${aideName} arrives`, icon: HeartHandshake },
    { action: 'aide_leaves', label: `${aideName} leaves`, icon: LogOut },
    { action: 'delivery', label: 'Package delivered', icon: Package },
    { action: 'package_collected', label: `${parent} brings it in`, icon: PackageCheck },
    { action: 'meals', label: 'Meals on Wheels rings', icon: Soup },
    { action: 'resident_out', label: `${parent} goes out`, icon: Footprints },
    { action: 'night_visitor', label: 'Someone at night', icon: MoonStar },
    { action: 'car_arrives', label: 'Car in the driveway', icon: Car },
    { action: 'doorbell', label: 'Doorbell press', icon: BellRing },
  ]

  async function fire(a: (typeof actions)[number]) {
    setBusy(a.action)
    try {
      await api.simEvent(a.action)
      pushToast({ tone: 'note', title: `Simulated: ${a.label}`, body: 'Homebeat is looking at it now. A moment may appear on Today in a few seconds.' })
    } catch (e) {
      const status = (e as { status?: number }).status
      pushToast({
        tone: 'heads_up',
        title: 'The simulator didn’t run',
        body: status === 409 ? 'Homebeat is connected to real Ring data, so the simulator is switched off.' : friendlyError(e),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cx('rounded-[20px] border border-dashed border-line-strong bg-paper p-4 sm:p-5', compact && 'border-0 p-0 sm:p-0')}>
      {!compact && (
        <div className="mb-3 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-note-bg text-note" aria-hidden>
            <FlaskConical className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="font-semibold">Offline simulator</p>
            <p className="text-[14px] text-ink-mute">Not real Ring data. Connect the Ring Developer Playground for real events.</p>
          </div>
        </div>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {actions.map((a) => (
          <li key={a.action}>
            <Button variant="secondary" size="sm" icon={a.icon} loading={busy === a.action} disabled={!!busy && busy !== a.action} onClick={() => fire(a)} className="w-full justify-start text-left">
              <span className="truncate">{a.label}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Small entry point (Today footer) that opens the simulator in a sheet. */
export function SimulatorEntry() {
  const available = useSimulatorAvailable()
  const [open, setOpen] = useState(false)
  if (!available) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-dashed border-line-strong text-[14px] font-medium text-ink-soft hover:border-primary hover:text-primary"
      >
        <FlaskConical className="size-[18px]" strokeWidth={1.75} aria-hidden />
        Offline simulator: try a pretend event
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Offline simulator">
        <p className="mb-4 text-[15px] text-ink-soft">Not real Ring data. Connect the Ring Developer Playground for real events.</p>
        <SimulatorPanel compact />
      </Sheet>
    </>
  )
}
