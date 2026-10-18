import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { BellRing, CalendarCheck, Check, Film, ImageOff, Loader2, Phone, ShieldCheck, ThumbsDown, ThumbsUp, Video, SearchX } from 'lucide-react'
import type { Analysis, Moment, VisitorType } from '@shared/types'
import { api, isMock } from '@/lib/api'
import { useApp } from '@/lib/store'
import { MOMENT_ICON, SEVERITY } from '@/lib/meta'
import { addDays, formatLongDay, formatTime, relativeTime, todayKey } from '@/lib/time'
import { FunnelTrace } from '@/components/FunnelTrace'
import { primaryMember, telHref } from '@/lib/format'
import { Button, ButtonLink, Card, EmptyState, PageHeader, SectionTitle, SeverityBadge, SeverityIcon, Skeleton, cx, friendlyError } from '@/components/ui'

const LOOKS_LIKE: Record<VisitorType, string> = {
  care_worker: 'a care worker',
  delivery: 'a delivery driver',
  family: 'family or a friend',
  service: 'someone doing a job at the house',
  unknown: 'someone Homebeat can’t place',
  resident: '{parent}',
}


function useMoment(id: string) {
  const { momentById, rememberMoments } = useApp()
  const cached = momentById(id)
  const [state, setState] = useState<{ m?: Moment; loading: boolean; missing?: boolean }>({ m: cached, loading: !cached })
  useEffect(() => {
    if (cached) {
      setState({ m: cached, loading: false })
      return
    }
    let alive = true
    ;(async () => {
      // Deep link to an older moment: look back through the last week.
      for (let i = 0; i < 8 && alive; i++) {
        const ms = await api.moments(addDays(todayKey(), -i)).catch(() => [] as Moment[])
        rememberMoments(ms)
        const found = ms.find((x) => x.id === id)
        if (found) {
          if (alive) setState({ m: found, loading: false })
          return
        }
      }
      if (alive) setState({ loading: false, missing: true })
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cached])
  return state
}

export default function MomentPage() {
  const { id = '' } = useParams()
  const { m, loading, missing } = useMoment(id)
  if (loading)
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="aspect-video w-full max-w-3xl rounded-[20px]" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
    )
  if (missing || !m)
    return (
      <Card>
        <EmptyState icon={SearchX} title="We couldn’t find that moment" body="It may be older than a week. Moments and their snapshots are kept for 30 days.">
          <ButtonLink to="/" variant="primary">
            Back to Today
          </ButtonLink>
        </EmptyState>
      </Card>
    )
  return <MomentView m={m} />
}

function MomentView({ m }: { m: Moment }) {
  const { upsertMoment, pushToast, today } = useApp()
  const parent = today.household.parentName
  const me = primaryMember(today.household)?.name ?? 'Family'
  const phone = today.household.parentPhone
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analysisState, setAnalysisState] = useState<'loading' | 'ok' | 'none' | 'error'>(m.analysisId ? 'loading' : 'none')
  const [busy, setBusy] = useState<string | null>(null)
  const [imgFailed, setImgFailed] = useState(false)
  const [clip, setClip] = useState<'off' | 'loading' | 'playing' | 'error'>('off')
  useEffect(() => {
    setImgFailed(false)
    setClip('off')
    setClipReady(false)
  }, [m.id])
  const canClip = m.eventIds.length > 0 && !isMock()
  const clipUrl = `/api/moments/${encodeURIComponent(m.id)}/clip`
  const [clipReady, setClipReady] = useState(false)
  // Ask the server first (it may take a few seconds to fetch from Ring); only mount the player for a real video.
  useEffect(() => {
    if (clip !== 'loading' || clipReady) return
    const ctrl = new AbortController()
    fetch(clipUrl, { headers: { Range: 'bytes=0-1' }, signal: ctrl.signal })
      .then((r) => {
        const type = r.headers.get('content-type') ?? ''
        void r.body?.cancel()
        if (r.ok && type.startsWith('video/')) setClipReady(true)
        else setClip('error')
      })
      .catch((e: Error) => e.name !== 'AbortError' && setClip('error'))
    return () => ctrl.abort()
  }, [clip, clipReady, clipUrl])

  useEffect(() => {
    if (!m.analysisId) return
    let alive = true
    setAnalysisState('loading')
    api.analysis(m.analysisId).then(
      (a) => {
        if (!alive) return
        setAnalysis(a)
        setAnalysisState('ok')
      },
      () => alive && setAnalysisState('error'),
    )
    return () => {
      alive = false
    }
  }, [m.analysisId])

  const s = SEVERITY[m.severity]
  const actions = new Set(m.actions ?? [])
  if (m.kind === 'after_dark' || m.kind === 'visitor') actions.add('watch_live')
  if (m.severity !== 'calm') actions.add('call_parent')
  if ((m.severity === 'urgent' || m.severity === 'heads_up') && !m.ack) actions.add('mark_handled')
  const device = today.devices.find((d) => d.id === m.deviceId)
  const confidence = m.confidence ?? analysis?.verdict.confidence
  const visitorType = analysis?.verdict.visitorType

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      pushToast({ tone: 'heads_up', title: 'That didn’t work', body: friendlyError(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <article>
      <PageHeader back="/" title={m.title} eyebrow={<span className="tabular">{formatLongDay(m.at)} · {formatTime(m.at)}{m.deviceName ? ` · ${m.deviceName}` : ''}</span>} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-8">
        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          {(clip === 'loading' || clip === 'playing') && clipReady ? (
            <figure className="relative overflow-hidden rounded-[20px] bg-ink shadow-[var(--shadow-card)]">
              <video
                src={clipUrl}
                controls
                autoPlay
                muted
                playsInline
                preload="none"
                poster={m.snapshotUrl && !imgFailed ? m.snapshotUrl : undefined}
                className="aspect-video w-full bg-ink object-contain"
                onLoadedData={() => setClip('playing')}
                onError={() => setClip('error')}
                aria-label={`Ring recording: ${m.title}`}
              />
              {clip === 'loading' && (
                <div className="absolute inset-0 grid place-items-center bg-ink/45 text-white" role="status">
                  <span className="flex flex-col items-center gap-2 text-[15px] font-medium">
                    <Loader2 className="size-8 animate-spin" strokeWidth={1.75} aria-hidden />
                    Fetching the recording from Ring…
                  </span>
                </div>
              )}
            </figure>
          ) : m.snapshotUrl && !imgFailed ? (
            <figure className="overflow-hidden rounded-[20px] bg-paper-deep shadow-[var(--shadow-card)]">
              <img src={m.snapshotUrl} alt={`${m.title}. ${m.body}`} className="aspect-video w-full object-cover" onError={() => setImgFailed(true)} />
              <figcaption className="sr-only">Snapshot from {m.deviceName ?? 'the Ring camera'}</figcaption>
            </figure>
          ) : (
            <div className={cx('flex aspect-[16/6] flex-col items-center justify-center gap-3 rounded-[20px]', s.bg)}>
              <SeverityIcon severity={m.severity} icon={MOMENT_ICON[m.kind]} size="lg" />
              {m.snapshotUrl && (
                <p className="flex items-center gap-1.5 text-[14px] text-ink-mute">
                  <ImageOff className="size-4" strokeWidth={1.75} aria-hidden /> No snapshot for this moment
                </p>
              )}
            </div>
          )}
          {clip === 'error' && (
            <p className="-mt-3 flex items-center gap-2 text-[14px] text-ink-mute" role="status">
              <Film className="size-4" strokeWidth={1.75} aria-hidden /> No recording available for this moment.
            </p>
          )}

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={m.severity} />
              <span className="text-[14px] text-ink-mute">{relativeTime(m.at)}</span>
              {m.sample && <span className="rounded-full bg-paper-deep px-2.5 py-1 text-[12px] font-medium text-ink-mute">Sample</span>}
            </div>
            <p className="mt-3 font-serif text-[21px] leading-relaxed text-ink">{m.body}</p>
            {confidence !== undefined && (
              <p className="mt-3 flex items-center gap-2 text-[15px] text-ink-soft">
                <ShieldCheck className="size-[18px] text-sage" strokeWidth={1.75} aria-hidden />
                {confidence < 0.8
                  ? `Looks like ${visitorType ? LOOKS_LIKE[visitorType].replace('{parent}', parent) : 'what’s described'}, but Homebeat isn’t certain (${Math.round(confidence * 100)}% sure).`
                  : `Homebeat is confident about this (${Math.round(confidence * 100)}% sure).`}
              </p>
            )}
            {m.ack && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-calm-bg px-3 py-1.5 text-[14px] font-medium text-calm">
                <Check className="size-4" strokeWidth={2.25} aria-hidden />
                Handled by {m.ack.by} · {formatTime(m.ack.at)}
              </p>
            )}
          </div>

        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start" aria-label="Actions">
          <Card className="space-y-2.5 p-4">
            {actions.has('watch_live') && m.deviceId && (
              <ButtonLink to={`/live/${m.deviceId}`} variant={m.severity === 'urgent' ? 'urgent' : 'primary'} icon={Video} className="w-full">
                Watch live{device?.maxLiveSeconds ? ` · ${device.maxLiveSeconds} s` : ''}
              </ButtonLink>
            )}
            {phone && (
              <a
                href={telHref(phone)}
                className={cx(
                  'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium transition-colors',
                  actions.has('watch_live') ? 'bg-white text-ink ring-1 ring-line-strong hover:bg-paper' : 'bg-primary text-white hover:bg-primary-hover',
                )}
              >
                <Phone className="size-[18px]" strokeWidth={1.75} aria-hidden />
                Call {parent}
              </a>
            )}
            {(actions.has('play_chime') || m.kind === 'delivery_waiting') && (
              <Button
                variant="secondary"
                icon={BellRing}
                className="w-full"
                loading={busy === 'chime'}
                onClick={() =>
                  run('chime', async () => {
                    const r = await api.chime(m.id)
                    if (!r.ok) throw new Error(r.error ?? 'The chime didn’t respond.')
                    pushToast({ tone: 'calm', title: `Chime played in ${parent}’s home`, body: 'A soft reminder tone on the Hallway Chime.' })
                  })
                }
              >
                Play chime in {parent}’s home
              </Button>
            )}
            {canClip && clip !== 'playing' && clip !== 'error' && (
              <Button variant="secondary" icon={Film} className="w-full" loading={clip === 'loading'} onClick={() => setClip('loading')}>
                Play the recording
              </Button>
            )}
            {m.visitId && (
              <ButtonLink to="/visits" variant="secondary" icon={CalendarCheck} className="w-full">
                View visit
              </ButtonLink>
            )}
            {actions.has('mark_handled') && !m.ack && (
              <Button
                variant="ghost"
                icon={Check}
                className="w-full"
                loading={busy === 'ack'}
                onClick={() =>
                  run('ack', async () => {
                    const updated = await api.ack(m.id, me)
                    upsertMoment(updated)
                    pushToast({ tone: 'calm', title: 'Marked as handled', body: 'The family can see you’ve taken care of it.' })
                  })
                }
              >
                Mark handled
              </Button>
            )}
          </Card>

          <Card className="p-5">
            <p className="text-[15px] font-semibold" id="fb-title">
              Was this right?
            </p>
            <p className="mt-0.5 text-[14px] text-ink-mute">Your answer helps Homebeat learn what matters at {parent}’s.</p>
            <div className="mt-3 flex gap-2" role="group" aria-labelledby="fb-title">
              {(['right', 'wrong'] as const).map((f) => {
                const active = m.feedback === f
                const Icon = f === 'right' ? ThumbsUp : ThumbsDown
                return (
                  <button
                    key={f}
                    aria-pressed={active}
                    disabled={busy === 'fb'}
                    onClick={() =>
                      run('fb', async () => {
                        const updated = await api.feedback(m.id, f)
                        upsertMoment(updated)
                      })
                    }
                    className={cx(
                      'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium ring-1 transition-colors',
                      active ? (f === 'right' ? 'bg-calm-bg text-calm ring-calm/30' : 'bg-heads-bg text-heads ring-heads/30') : 'bg-white text-ink-soft ring-line-strong hover:bg-paper',
                    )}
                  >
                    <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                    {f === 'right' ? 'Yes' : 'Not quite'}
                  </button>
                )
              })}
            </div>
            {m.feedback && <p className="mt-2.5 text-[14px] text-ink-mute" role="status">Thanks, noted.</p>}
          </Card>
        </aside>
        {m.analysisId && (
        <section aria-labelledby="trace-title" className="min-w-0 lg:col-start-1 lg:row-start-2">
          <Card className="p-5 sm:p-6">
            <SectionTitle id="trace-title" action={<Link to="/how" className="text-[14px] font-medium text-primary">How this works</Link>}>
              How Homebeat looked at this
            </SectionTitle>
            {analysisState === 'loading' && (
              <div className="grid gap-3 md:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 rounded-2xl" />
                ))}
              </div>
            )}
            {analysisState === 'ok' && analysis && <FunnelTrace analysis={analysis} />}
            {analysisState === 'none' && (
              <p className="text-[15px] text-ink-mute">
                {m.kind === 'quiet'
                  ? 'This moment comes from the absence of activity, so no snapshot was checked.'
                  : 'This moment came straight from the device, so no snapshot was checked.'}
              </p>
            )}
            {analysisState === 'error' && <p className="text-[15px] text-ink-mute">The details for this moment aren’t available right now.</p>}
          </Card>
        </section>
        )}
      </div>
    </article>
  )
}
