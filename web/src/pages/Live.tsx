import { Link, useParams } from 'react-router'
import { BatteryFull, BatteryLow, BatteryMedium, ChevronRight, Lock, Plug, VideoOff } from 'lucide-react'
import type { Device } from '@shared/types'
import { useApp } from '@/lib/store'
import { DEVICE_ICON } from '@/lib/meta'
import { relativeTime } from '@/lib/time'
import { Card, EmptyState, PageHeader, StatusDot, cx } from '@/components/ui'
import { LivePlayer, isWired, maxSecondsFor, posterFor } from '@/components/LivePlayer'

export default function LivePage() {
  const { deviceId } = useParams()
  const { today } = useApp()
  const parent = today.household.parentName
  const cams = today.devices.filter((d) => d.kind === 'doorbell' || d.kind === 'camera')
  const device = deviceId ? cams.find((d) => d.id === deviceId) : undefined

  if (!cams.length) {
    return (
      <div>
        <PageHeader title="Live view" />
        <Card>
          <EmptyState icon={VideoOff} title="No cameras linked yet" body={`Once ${parent}'s Ring doorbell or cameras are linked, you can look in from here.`} />
        </Card>
      </div>
    )
  }

  if (deviceId && !device) {
    return (
      <div>
        <PageHeader title="Live view" back="/live" />
        <Card>
          <EmptyState icon={VideoOff} title="We can’t find that camera" body="It may have been removed in the Ring app. Pick another one below." />
        </Card>
        <Picker cams={cams} />
      </div>
    )
  }

  if (!device) {
    return (
      <div>
        <PageHeader
          title="Look in at home"
          subtitle={`See what ${parent}'s doorbell or driveway camera sees right now. Live view is short on purpose, to save battery and respect ${parent}'s privacy.`}
        />
        <Picker cams={cams} />
      </div>
    )
  }

  const others = cams.filter((c) => c.id !== device.id)
  return (
    <div>
      <PageHeader
        back="/live"
        title={device.name}
        subtitle={`Live from ${today.household.homeName}. ${isWired(device) ? 'Wired camera' : 'Battery doorbell'}, up to ${maxSecondsFor(device)} seconds at a time.`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <LivePlayer key={device.id} device={device} parentName={parent} autoStart />
        <aside aria-label="Other cameras">
          {others.length > 0 && (
            <>
              <h2 className="mb-3 font-serif text-[19px] font-medium">Other cameras</h2>
              <ul className="space-y-3">
                {others.map((d) => (
                  <li key={d.id}>
                    <DeviceRow d={d} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-5 rounded-2xl bg-paper-deep p-4 text-[14px] leading-relaxed text-ink-soft">
            Live view is watch-only and kept brief to respect {parent}’s privacy. Change motion zones and privacy zones in the Ring app.
          </p>
        </aside>
      </div>
    </div>
  )
}

function Picker({ cams }: { cams: Device[] }) {
  return (
    <ul className="mt-2 grid gap-4 sm:grid-cols-2">
      {cams.map((d) => (
        <li key={d.id}>
          <DeviceCard d={d} />
        </li>
      ))}
    </ul>
  )
}

function Battery({ d }: { d: Device }) {
  if (isWired(d))
    return (
      <span className="inline-flex items-center gap-1">
        <Plug className="size-4" strokeWidth={1.75} aria-hidden /> Wired
      </span>
    )
  const b = d.battery ?? 0
  const Icon = b > 60 ? BatteryFull : b > 25 ? BatteryMedium : BatteryLow
  return (
    <span className={cx('inline-flex items-center gap-1', b <= 25 && 'text-heads')}>
      <Icon className="size-4" strokeWidth={1.75} aria-hidden /> {b}% battery
    </span>
  )
}

function DeviceCard({ d }: { d: Device }) {
  const Icon = DEVICE_ICON[d.kind]
  const unavailable = d.encrypted || d.online === false
  return (
    <Link to={`/live/${d.id}`} className="card group block overflow-hidden transition-shadow hover:shadow-[var(--shadow-lift)]">
      <div className="relative aspect-video bg-paper-deep">
        <img src={posterFor(d)} alt="" className={cx('size-full object-cover', unavailable && 'opacity-60 grayscale')} />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/92 px-2.5 py-1 text-[13px] font-medium text-ink shadow-sm">
          <StatusDot tone={d.online === false ? 'off' : 'ok'} />
          {d.online === false ? 'Offline' : 'Online'}
        </span>
        {d.encrypted && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/92 px-2.5 py-1 text-[13px] font-medium text-note">
            <Lock className="size-3.5" strokeWidth={2} aria-hidden /> Encrypted
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 p-4">
        <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
          <Icon className="size-[22px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold">{d.name}</p>
          <p className="flex flex-wrap gap-x-3 text-[13px] text-ink-mute">
            <Battery d={d} />
            <span>{maxSecondsFor(d)} s live</span>
            {d.lastEventAt && <span>Last activity {relativeTime(d.lastEventAt)}</span>}
          </p>
        </div>
        <ChevronRight className="size-5 text-ink-mute transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
      </div>
    </Link>
  )
}

function DeviceRow({ d }: { d: Device }) {
  return (
    <Link to={`/live/${d.id}`} className="card flex items-center gap-3 p-3 hover:shadow-[var(--shadow-lift)]">
      <img src={posterFor(d)} alt="" className="h-14 w-24 rounded-xl object-cover" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{d.name}</p>
        <p className="text-[13px] text-ink-mute">
          <Battery d={d} />
        </p>
      </div>
      <ChevronRight className="size-5 text-ink-mute" strokeWidth={1.75} aria-hidden />
    </Link>
  )
}
