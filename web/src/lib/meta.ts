import type { MomentKind, Severity, VisitStatus, Visit, VisitEvidence, RuleTemplate, DeviceKind } from '@shared/types'
import {
  AlertCircle,
  BellRing,
  Car,
  CheckCircle2,
  CircleAlert,
  Clock,
  CloudMoon,
  DoorOpen,
  Eye,
  Footprints,
  Hand,
  HeartHandshake,
  Home,
  Info,
  Link2,
  LogOut,
  MoonStar,
  Package,
  PackageCheck,
  PackageOpen,
  ScanSearch,
  Settings2,
  Sparkles,
  UserRound,
  Activity,
  CalendarClock,
  CircleSlash,
  Hourglass,
  BellElectric,
  Cctv,
  Speaker,
  Radar,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react'

export const SEVERITY: Record<Severity, { label: string; icon: LucideIcon; text: string; bg: string; ring: string; dot: string; solid: string }> = {
  calm: { label: 'All good', icon: CheckCircle2, text: 'text-calm', bg: 'bg-calm-bg', ring: 'ring-calm/20', dot: 'bg-sage', solid: 'bg-calm' },
  note: { label: 'Good to know', icon: Info, text: 'text-note', bg: 'bg-note-bg', ring: 'ring-note/20', dot: 'bg-note', solid: 'bg-note' },
  heads_up: { label: 'Heads-up', icon: CircleAlert, text: 'text-heads', bg: 'bg-heads-bg', ring: 'ring-heads/25', dot: 'bg-heads', solid: 'bg-heads' },
  urgent: { label: 'Needs you', icon: AlertCircle, text: 'text-urgent', bg: 'bg-urgent-bg', ring: 'ring-urgent/25', dot: 'bg-urgent', solid: 'bg-urgent' },
}

export const MOMENT_ICON: Record<MomentKind, LucideIcon> = {
  visit_arrived: HeartHandshake,
  visit_departed: LogOut,
  visit_late: Hourglass,
  visit_missed: CircleSlash,
  delivery: Package,
  delivery_waiting: PackageOpen,
  delivery_collected: PackageCheck,
  visitor: UserRound,
  after_dark: MoonStar,
  resident_out: Footprints,
  resident_back: Home,
  quiet: CloudMoon,
  vehicle: Car,
  rule: Sparkles,
  system: Settings2,
}

export const VISIT_STATUS: Record<VisitStatus, { label: string; icon: LucideIcon; cls: string }> = {
  upcoming: { label: 'Upcoming', icon: CalendarClock, cls: 'bg-paper-deep text-ink-soft ring-1 ring-line-strong' },
  due: { label: 'Due now', icon: Clock, cls: 'bg-note-bg text-note' },
  in_progress: { label: 'In progress', icon: Activity, cls: 'bg-primary-soft text-primary' },
  completed: { label: 'On time', icon: CheckCircle2, cls: 'bg-calm-bg text-calm' },
  late: { label: 'Late', icon: Hourglass, cls: 'bg-heads-bg text-heads' },
  missed: { label: 'Missed', icon: CircleSlash, cls: 'bg-urgent-bg text-urgent' },
}

export function visitStatusLabel(v: Visit) {
  if (v.status === 'late' && v.lateByMin) return `${v.lateByMin} min late`
  return VISIT_STATUS[v.status].label
}

export const EVIDENCE: Record<VisitEvidence['kind'], { label: string; icon: LucideIcon }> = {
  ring_motion: { label: 'Ring motion', icon: Radar },
  ring_ding: { label: 'Doorbell press', icon: BellRing },
  vehicle_match: { label: 'Vehicle match', icon: Car },
  checkin_link: { label: 'Check-in link', icon: Link2 },
  vision: { label: 'Seen at the door', icon: ScanSearch },
}

export const RULE_TEMPLATE: Record<RuleTemplate, { label: string; icon: LucideIcon; tint: string }> = {
  expected_visit: { label: 'Expected visit', icon: CalendarClock, tint: 'bg-primary-soft text-primary' },
  package_waiting: { label: 'Package left outside', icon: Package, tint: 'bg-heads-bg text-heads' },
  quiet_hours: { label: 'After dark', icon: MoonStar, tint: 'bg-note-bg text-note' },
  no_activity: { label: 'Quiet day', icon: CloudMoon, tint: 'bg-calm-bg text-calm' },
  unknown_vehicle: { label: 'Unfamiliar car', icon: Car, tint: 'bg-note-bg text-note' },
  custom_watch: { label: 'Look out for', icon: Eye, tint: 'bg-primary-soft text-primary' },
}

export const DEVICE_ICON: Record<DeviceKind, LucideIcon> = {
  doorbell: BellElectric,
  camera: Cctv,
  chime: Speaker,
  sensor: DoorOpen,
  unknown: HelpCircle,
}

export const ICONS = { Hand }

/** Human label for a param key in a compiled rule. */
export function paramPill(key: string, value: string | number | boolean | number[]): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const clock = (s: string) => {
    if (!/^\d{1,2}:\d{2}$/.test(s)) return s
    const [h, m] = s.split(':').map(Number)
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }
  switch (key) {
    case 'minutes':
      return `after ${value} min`
    case 'hours':
      return `${value} hours of quiet`
    case 'start':
      return `from ${clock(String(value))}`
    case 'end':
      return `until ${clock(String(value))}`
    case 'from':
      return `watching from ${clock(String(value))}`
    case 'to':
      return `until ${clock(String(value))}`
    case 'windowStart':
      return `arrives from ${clock(String(value))}`
    case 'windowEnd':
      return `on time by ${clock(String(value))}`
    case 'graceMin':
      return `missed after ${value} min`
    case 'days':
      return Array.isArray(value) ? (value.length === 5 && !value.includes(0) && !value.includes(6) ? 'Weekdays' : value.map((d) => days[d]).join(' · ')) : String(value)
    case 'question':
      return `“${value}”`
    case 'who':
      return `${value}`
    default:
      return `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`
  }
}
