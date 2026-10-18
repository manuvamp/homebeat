import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, Lock, Mic, Play, RotateCcw, Square, Volume2, VolumeX, WifiOff } from 'lucide-react'
import type { Device } from '@shared/types'
import { api, isMock } from '@/lib/api'
import { getHouseholdTz } from '@/lib/time'
import { Button, cx, friendlyError } from './ui'

type Phase = 'idle' | 'connecting' | 'live' | 'ended' | 'error'
type EndReason = 'timeout' | 'user'

const POSTER: Record<string, string> = {
  'dev-front': '/placeholders/door-empty.svg',
  'dev-drive': '/placeholders/driveway-car.svg',
}
export function posterFor(d: Device) {
  return d.imageUrl ?? POSTER[d.id] ?? (d.kind === 'camera' ? '/placeholders/driveway-car.svg' : '/placeholders/door-empty.svg')
}
export function isWired(d: Device) {
  return d.battery === null || d.battery === undefined
}
export function maxSecondsFor(d: Device) {
  return d.maxLiveSeconds ?? (isWired(d) ? 60 : 30)
}

/** Wait until ICE gathering completes, or give up after `ms` and use what we have. */
function waitForIce(pc: RTCPeerConnection, ms: number) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t)
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    const t = setTimeout(done, ms)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

/** A pretend live feed for mock mode: the placeholder image drawn to a canvas with a gentle flicker and a running clock. */
function simulatedStream(src: string): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')!
  const img = new Image()
  img.src = src
  let raf = 0
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: getHouseholdTz(), hour: 'numeric', minute: '2-digit', second: '2-digit' })
  const draw = (t: number) => {
    const b = 0.97 + Math.sin(t / 700) * 0.02 + (Math.random() - 0.5) * 0.015
    ctx.filter = `brightness(${b}) saturate(0.92)`
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, 1280, 720)
    else {
      ctx.fillStyle = '#2a332f'
      ctx.fillRect(0, 0, 1280, 720)
    }
    ctx.filter = 'none'
    // subtle sensor noise
    ctx.fillStyle = 'rgba(255,255,255,0.025)'
    for (let i = 0; i < 120; i++) ctx.fillRect(Math.random() * 1280, Math.random() * 720, 2, 2)
    ctx.font = '600 26px system-ui, sans-serif'
    const text = fmt.format(Date.now())
    const w = ctx.measureText(text).width
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.roundRect(1280 - w - 56, 590, w + 32, 44, 22)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(text, 1280 - w - 40, 621)
    raf = requestAnimationFrame(draw)
  }
  raf = requestAnimationFrame(draw)
  const stream = canvas.captureStream(15)
  return {
    stream,
    stop: () => {
      cancelAnimationFrame(raf)
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}

export function LivePlayer({ device, parentName, autoStart }: { device: Device; parentName: string; autoStart?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [endReason, setEndReason] = useState<EndReason>('timeout')
  const [error, setError] = useState('')
  const [left, setLeft] = useState(0)
  const [max, setMax] = useState(maxSecondsFor(device))
  const [muted, setMuted] = useState(true)
  const session = useRef<{ pc?: RTCPeerConnection; sessionId?: string; stopSim?: () => void; timer?: ReturnType<typeof setInterval>; stopped: boolean; gen: number }>({
    stopped: true,
    gen: 0,
  })
  const wired = isWired(device)

  const teardown = useCallback(() => {
    const s = session.current
    if (s.stopped) return
    s.stopped = true
    s.gen++
    clearInterval(s.timer)
    s.stopSim?.()
    s.pc?.getReceivers().forEach((r) => r.track?.stop())
    s.pc?.close()
    const id = s.sessionId
    s.pc = undefined
    s.sessionId = undefined
    s.stopSim = undefined
    if (videoRef.current) videoRef.current.srcObject = null
    if (id) void api.stopLive(id).catch(() => {})
  }, [])

  const stop = useCallback(
    (reason: EndReason) => {
      teardown()
      setEndReason(reason)
      setPhase('ended')
    },
    [teardown],
  )

  const startCountdown = useCallback(
    (seconds: number, gen: number) => {
      const s = session.current
      const endAt = Date.now() + seconds * 1000
      setMax(seconds)
      setLeft(seconds)
      clearInterval(s.timer)
      s.timer = setInterval(() => {
        if (session.current.gen !== gen) return
        const remain = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
        setLeft(remain)
        if (remain <= 0) stop('timeout')
      }, 250)
    },
    [stop],
  )

  const start = useCallback(async () => {
    if (device.encrypted || device.online === false) return
    teardown()
    const s = session.current
    s.stopped = false
    const gen = ++s.gen
    setError('')
    setPhase('connecting')
    try {
      if (isMock()) {
        await new Promise((r) => setTimeout(r, 1200))
        if (s.gen !== gen) return
        const sim = simulatedStream(posterFor(device))
        s.stopSim = sim.stop
        if (videoRef.current) {
          videoRef.current.srcObject = sim.stream
          void videoRef.current.play().catch(() => {})
        }
        setPhase('live')
        startCountdown(maxSecondsFor(device), gen)
        return
      }
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      s.pc = pc
      // Ring only supports receive-only live view.
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })
      const media = new MediaStream()
      pc.ontrack = (e) => {
        media.addTrack(e.track)
        if (videoRef.current && videoRef.current.srcObject !== media) {
          videoRef.current.srcObject = media
          void videoRef.current.play().catch(() => {})
        }
      }
      pc.onconnectionstatechange = () => {
        if (s.gen !== gen) return
        if (pc.connectionState === 'failed') {
          teardown()
          setError(`We lost the connection to ${device.name}. The Wi-Fi at ${parentName}'s may be weak right now.`)
          setPhase('error')
        }
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await waitForIce(pc, 3000)
      if (s.gen !== gen) return
      const res = await api.startLive(device.id, pc.localDescription!.sdp)
      if (s.gen !== gen) {
        void api.stopLive(res.sessionId).catch(() => {})
        return
      }
      s.sessionId = res.sessionId
      await pc.setRemoteDescription({ type: 'answer', sdp: res.sdpAnswer })
      setPhase('live')
      startCountdown(res.maxSeconds || maxSecondsFor(device), gen)
    } catch (e) {
      if (s.gen !== gen) return
      teardown()
      const msg = friendlyError(e)
      setError(
        /busy|409|in use/i.test(msg)
          ? `${device.name} is already showing live video somewhere else. Try again in a minute.`
          : `We couldn’t connect to ${device.name}. It may be busy or its Wi-Fi may be weak. Please try again in a moment.`,
      )
      setPhase('error')
    }
  }, [device, parentName, startCountdown, teardown])

  // Auto-start when opened from "Watch live"; always clean up on unmount or device change.
  useEffect(() => {
    setPhase('idle')
    if (autoStart) void start()
    return () => teardown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  if (device.encrypted) {
    return (
      <Frame poster={posterFor(device)} dim>
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-md rounded-[20px] bg-white/95 p-5 text-center shadow-lg">
            <Lock className="mx-auto mb-2 size-7 text-note" strokeWidth={1.75} aria-hidden />
            <p className="text-[16px] leading-relaxed text-ink">
              {parentName}’s {device.name} uses end-to-end encryption, so video can’t be shown in Homebeat. Moments still work from motion alerts.
            </p>
          </div>
        </div>
      </Frame>
    )
  }
  if (device.online === false) {
    return (
      <Frame poster={posterFor(device)} dim>
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-md rounded-[20px] bg-white/95 p-5 text-center shadow-lg">
            <WifiOff className="mx-auto mb-2 size-7 text-heads" strokeWidth={1.75} aria-hidden />
            <p className="text-[16px] leading-relaxed text-ink">{device.name} is offline right now, so live view isn’t available. Check its Wi-Fi or power in the Ring app.</p>
          </div>
        </div>
      </Frame>
    )
  }

  const pct = max ? left / max : 0
  return (
    <div>
      {/* Status sits above the picture, never on it: Ring's watermark (logo, device and partner, time) stays fully visible. */}
      <div className="mb-3 flex min-h-14 items-center gap-2">
        {phase === 'live' && (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-urgent px-2.5 py-1 text-[12px] font-bold tracking-wider text-white">
              <span className="size-2 animate-pulse rounded-full bg-white" aria-hidden /> LIVE
            </span>
            <span className="text-[15px] font-medium text-ink-soft">{device.name}</span>
            {isMock() && <span className="text-[13px] text-ink-mute">· Simulated feed (sample data)</span>}
            <span className="ml-auto" role="timer" aria-live="off" aria-label={`${left} seconds left`}>
              <CountdownRing pct={pct} left={left} />
            </span>
          </>
        )}
      </div>
      <Frame poster={posterFor(device)} dim={phase !== 'live'}>
        <video
          ref={videoRef}
          className={cx('absolute inset-0 size-full object-contain', phase === 'live' ? 'opacity-100' : 'opacity-0')}
          autoPlay
          playsInline
          muted={muted}
          aria-label={`Live video from ${device.name}`}
        />
        {phase === 'idle' && (
          <Overlay>
            <Button size="lg" icon={Play} onClick={() => void start()}>
              Watch {device.name} live
            </Button>
            <p className="mt-3 text-[14px] text-white/85">Up to {maxSecondsFor(device)} seconds{wired ? '' : ' to save the battery'}</p>
          </Overlay>
        )}
        {phase === 'connecting' && (
          <Overlay>
            <Loader2 className="size-9 animate-spin text-white" strokeWidth={1.75} aria-hidden />
            <p className="mt-3 text-[16px] font-medium text-white" role="status">
              Connecting to {device.name}…
            </p>
            <p className="mt-1 text-[14px] text-white/75">This usually takes a few seconds.</p>
          </Overlay>
        )}
        {phase === 'ended' && (
          <Overlay>
            <p className="max-w-sm text-center text-[16px] font-medium text-white" role="status">
              {endReason === 'user'
                ? 'Live view stopped.'
                : wired
                  ? `Live view ends after ${max} s. You can start it again any time.`
                  : `Live view ends after ${max} s to save the doorbell’s battery.`}
            </p>
            <Button className="mt-4" variant="secondary" icon={RotateCcw} onClick={() => void start()}>
              Watch again
            </Button>
          </Overlay>
        )}
        {phase === 'error' && (
          <Overlay>
            <p className="max-w-md text-center text-[16px] leading-relaxed font-medium text-white" role="alert">
              {error}
            </p>
            <Button className="mt-4" variant="secondary" icon={RotateCcw} onClick={() => void start()}>
              Try again
            </Button>
          </Overlay>
        )}
      </Frame>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {phase === 'live' || phase === 'connecting' ? (
          <Button variant="secondary" icon={Square} onClick={() => stop('user')}>
            Stop
          </Button>
        ) : (
          <Button icon={Play} onClick={() => void start()}>
            {phase === 'idle' ? 'Start live view' : 'Watch again'}
          </Button>
        )}
        <Button
          variant="quiet"
          icon={muted ? VolumeX : Volume2}
          onClick={() => setMuted((m) => !m)}
          aria-pressed={!muted}
          aria-label={muted ? 'Turn sound on' : 'Mute sound'}
        >
          {muted ? 'Sound off' : 'Sound on'}
        </Button>
        <p className="flex items-center gap-1.5 text-[13px] text-ink-mute sm:ml-auto">
          <Mic className="size-4" strokeWidth={1.75} aria-hidden />
          Talk is not available in Homebeat; use the Ring app to speak.
        </p>
      </div>
    </div>
  )
}

function Frame({ poster, dim, children }: { poster: string; dim?: boolean; children: ReactNode }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[20px] bg-[#1b2420] shadow-[var(--shadow-card)]">
      <img src={poster} alt="" className={cx('absolute inset-0 size-full object-cover transition-[filter,opacity] duration-500', dim ? 'opacity-70 blur-[3px] brightness-75' : 'opacity-0')} />
      {children}
    </div>
  )
}

function Overlay({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex animate-fade-in flex-col items-center justify-center bg-[#1b2420]/35 p-6">{children}</div>
}

function CountdownRing({ pct, left }: { pct: number; left: number }) {
  const r = 20
  const c = 2 * Math.PI * r
  return (
    <span className="relative grid size-14 place-items-center rounded-full bg-[#1b2420]">
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-14 -rotate-90" aria-hidden>
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="3" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke={left <= 5 ? '#F4B183' : '#fff'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 250ms linear' }}
        />
      </svg>
      <span className="text-[15px] font-semibold text-white tabular">{left}s</span>
    </span>
  )
}
