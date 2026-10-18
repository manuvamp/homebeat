import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { Household, LiveSessionResponse, Moment, Schedule, Severity, TodaySummary } from '../../../shared/types.ts'
import { addClient } from '../bus.ts'
import { playChime } from '../care/engine.ts'
import { updateMoment } from '../care/moments.ts'
import { funnelStats, dailyDigest, momentsOn, weeklyReport } from '../care/reports.ts'
import { compileRule, saveRule, syncSchedule } from '../care/rules.ts'
import { resetForDemo } from '../care/seed.ts'
import { checkIn, ensureVisits } from '../care/visits.ts'
import { config } from '../config.ts'
import { setSetting, uid } from '../db.ts'
import { pollHistory, ringError } from '../ingest.ts'
import { clearToken, tokenState, usePlaygroundToken } from '../ring/auth.ts'
import { apiLog, RingApiError, subscriptions as ringSubscriptions } from '../ring/client.ts'
import { api, noteOwnLive, refreshDevices, ringMode } from '../ring/index.ts'
import { simulate, type SimAction } from '../ring/sim.ts'
import { analyses, devices, events, household, moments, rules, schedules, visits } from '../store.ts'
import { addDays, atLocal, clock, localDate } from '../time.ts'

const RANK: Record<Severity, number> = { calm: 0, note: 1, heads_up: 2, urgent: 3 }
const live = new Map<string, { location: string; deviceId: string; timer: NodeJS.Timeout; startedAt: number }>()

function fail(reply: any, err: unknown) {
  const status = err instanceof RingApiError ? err.status : 400
  return reply.code(status >= 400 && status < 600 ? status : 500).send({ error: (err as Error).message })
}

export function today(): TodaySummary {
  const h = household.get()
  const date = localDate(Date.now())
  const ms = momentsOn(date)
  const visitsToday = ensureVisits(date)
  const start = atLocal(date, '00:00')
  const rawEvents = events.count('WHERE at >= ? AND kind != ?', start, 'on_demand')
  const live = ms.filter((m) => !m.sample)
  const open = live.filter((m) => !m.ack && RANK[m.severity] >= RANK.heads_up).sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.at - a.at)
  const inProgress = visitsToday.find((v) => v.status === 'in_progress')
  const done = visitsToday.filter((v) => v.status === 'completed')
  const next = visitsToday.filter((v) => ['upcoming', 'due'].includes(v.status)).sort((a, b) => a.expectedStart - b.expectedStart)[0]
  let status: TodaySummary['status']
  if (open.length) status = { severity: open[0].severity, headline: open[0].title, detail: open[0].body }
  else if (inProgress) status = { severity: 'calm', headline: `${inProgress.who.split(/[ (]/)[0]} is with ${h.parentName} now`, detail: `${inProgress.label} started at ${clock(inProgress.arrivedAt!)}.` }
  else
    status = {
      severity: 'calm',
      headline: `All calm at ${h.parentName}'s`,
      detail: done.length
        ? done.map((v) => `${v.label} done · ${clock(v.arrivedAt!)}–${clock(v.departedAt!)}`).join(' · ')
        : next
          ? `Next: ${next.label} around ${clock(next.expectedStart)}`
          : 'Nothing needs your attention.',
    }
  const lastEvent = events.all('WHERE kind != ? ORDER BY at DESC LIMIT 1', 'on_demand')[0]
  return {
    household: { ...h, ringMode: ringMode(), tokenExpiresAt: tokenState().expiresAt },
    status,
    nextVisit: next,
    visitsToday,
    moments: ms,
    counts: { rawEvents, moments: live.length, notified: live.filter((m) => RANK[m.severity] >= RANK.heads_up).length },
    devices: devices.all(),
    lastSeenAt: lastEvent?.at,
  }
}

export async function apiRoutes(app: FastifyInstance) {
  app.get('/api/today', async () => today())

  app.get('/api/moments', async (req) => {
    const { date } = req.query as { date?: string }
    return momentsOn(date ?? localDate(Date.now()))
  })

  app.post('/api/moments/:id/ack', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { by } = (req.body ?? {}) as { by?: string }
    const m = updateMoment(id, { ack: { by: by || household.get().members[0]?.name || 'Family', at: Date.now() } })
    return m ?? reply.code(404).send({ error: 'Not found' })
  })

  app.post('/api/moments/:id/feedback', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { feedback } = (req.body ?? {}) as { feedback?: Moment['feedback'] }
    const m = updateMoment(id, { feedback: feedback === 'right' || feedback === 'wrong' ? feedback : null })
    // Corrections are kept with the analysis: the labelled set a Stage 2 model would be tuned on (CV guide: close the loop).
    if (m?.analysisId) {
      const a = analyses.get(m.analysisId)
      if (a) analyses.put({ ...a, verdict: { ...a.verdict, ...(feedback === 'wrong' ? { confidence: 0 } : {}) } })
    }
    return m ?? reply.code(404).send({ error: 'Not found' })
  })

  app.post('/api/moments/:id/chime', async () => {
    const ok = await playChime('ring-appstore-event-1')
    return ok ? { ok, slot: 'ring-appstore-event-1' } : { ok, error: 'No chime with a Homebeat audio slot is available' }
  })

  // The Ring recording behind a moment (Media Clips API), fetched on demand and cached as an MP4.
  app.get('/api/moments/:id/clip', async (req, reply) => {
    const m = moments.get((req.params as { id: string }).id)
    const event = m?.eventIds[0] ? events.get(m.eventIds[0]) : undefined
    if (!m || !event) return reply.code(404).send({ error: 'No recording for this moment' })
    const file = join(config.dataDir, 'media', `clip_${m.id}.mp4`)
    if (!existsSync(file)) {
      try {
        const clip = await api().clip(event.deviceId, event.at - 3_000, 15_000)
        writeFileSync(file, clip.bytes)
      } catch (err) {
        return fail(reply, err)
      }
    }
    reply.header('Cache-Control', 'private, max-age=86400')
    return reply.type('video/mp4').send(createReadStream(file))
  })

  app.get('/api/visits', async (req) => {
    const q = req.query as { from?: string; to?: string }
    const to = q.to ?? localDate(Date.now())
    const from = q.from ?? addDays(to, -6)
    const out = []
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(...ensureVisits(d))
    return out
  })

  app.get('/api/schedules', async () => schedules.all())
  app.post('/api/schedules', async (req) => {
    const body = req.body as Omit<Schedule, 'id'>
    return schedules.put({ ...body, id: uid('s'), checkinCode: body.checkinCode || Math.random().toString(36).slice(2, 8) })
  })
  app.put('/api/schedules/:id', async (req) => {
    const { id } = req.params as { id: string }
    // Unstarted visits pick up the new window on the next tick.
    return schedules.put({ ...(req.body as Schedule), id })
  })
  app.delete('/api/schedules/:id', async (req) => {
    const { id } = req.params as { id: string }
    schedules.remove(id)
    for (const v of visits.all('WHERE schedule_id = ?', id)) if (v.status === 'upcoming') visits.remove(v.id)
    return { ok: true }
  })

  app.get('/api/rules', async () => rules.all().sort((a, b) => b.createdAt - a.createdAt))
  app.post('/api/rules/compile', async (req, reply) => {
    const { english } = (req.body ?? {}) as { english?: string }
    if (!english?.trim()) return reply.code(400).send({ error: 'Tell Homebeat what to look out for' })
    try {
      return await compileRule(english.trim())
    } catch (err) {
      return reply.code(422).send({ error: (err as Error).message })
    }
  })
  app.post('/api/rules', async (req, reply) => {
    const { english, compiled } = req.body as { english: string; compiled: any }
    try {
      return saveRule(english, compiled)
    } catch (err) {
      return reply.code(422).send({ error: (err as Error).message })
    }
  })
  app.patch('/api/rules/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const rule = rules.get(id)
    if (!rule) return reply.code(404).send({ error: 'Not found' })
    const updated = rules.put({ ...rule, enabled: Boolean((req.body as { enabled: boolean }).enabled) })
    if (updated.compiled.template === 'expected_visit') syncSchedule(updated)
    return updated
  })
  app.delete('/api/rules/:id', async (req) => {
    const { id } = req.params as { id: string }
    rules.remove(id)
    schedules.remove(`s_${id}`)
    return { ok: true }
  })

  app.get('/api/devices', async () => devices.all())
  app.post('/api/devices/refresh', async (req, reply) => {
    try {
      return await refreshDevices()
    } catch (err) {
      return fail(reply, err)
    }
  })

  // WHEP live view, proxied: Ring's API only accepts server-to-server calls (no browser CORS).
  app.post('/api/live/:deviceId', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string }
    const { sdp } = (req.body ?? {}) as { sdp?: string }
    const device = devices.get(deviceId)
    if (!device || !sdp) return reply.code(400).send({ error: 'Missing device or SDP offer' })
    if (device.encrypted) return reply.code(409).send({ error: 'encrypted' })
    try {
      const startedAt = Date.now()
      noteOwnLive(deviceId, startedAt)
      const { answer, location } = await api().whepOffer(deviceId, sdp)
      const sessionId = randomUUID()
      const maxSeconds = device.maxLiveSeconds ?? 30
      // Close proactively at the device limit so a forgotten tab never drains the doorbell battery.
      const timer = setTimeout(() => void closeLive(sessionId), (maxSeconds + 2) * 1000)
      live.set(sessionId, { location, deviceId, timer, startedAt })
      const res: LiveSessionResponse = { sdpAnswer: answer, sessionId, maxSeconds }
      return res
    } catch (err) {
      return fail(reply, err)
    }
  })
  app.delete('/api/live/:sessionId', async (req) => {
    await closeLive((req.params as { sessionId: string }).sessionId)
    return { ok: true }
  })

  app.get('/api/analysis/:id', async (req, reply) => analyses.get((req.params as { id: string }).id) ?? reply.code(404).send({ error: 'Not found' }))
  app.get('/api/funnel', async (req) => funnelStats(Number((req.query as { days?: string }).days ?? 30)))
  app.get('/api/digest', async (req) => dailyDigest((req.query as { date?: string }).date ?? localDate(Date.now())))
  app.get('/api/report', async (req) => {
    const q = req.query as { weekOf?: string }
    return weeklyReport(q.weekOf ?? addDays(localDate(Date.now()), -6))
  })

  app.get('/api/household', async () => ({ ...household.get(), ringMode: ringMode(), tokenExpiresAt: tokenState().expiresAt }))
  app.put('/api/household', async (req) => {
    const body = req.body as Partial<Household>
    const allowed: Partial<Household> = {}
    if (body.quietHours) allowed.quietHours = body.quietHours
    if (body.members) allowed.members = body.members
    if (body.parentName) allowed.parentName = body.parentName
    if (body.homeName) allowed.homeName = body.homeName
    if (body.timezone) allowed.timezone = body.timezone
    if (body.parentPhone !== undefined) allowed.parentPhone = body.parentPhone
    if (typeof body.escalateAfterMin === 'number' && body.escalateAfterMin >= 1) allowed.escalateAfterMin = body.escalateAfterMin
    return household.patch(allowed)
  })

  app.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    reply.raw.write(`data: ${JSON.stringify({ type: 'ring', mode: ringMode(), tokenExpiresAt: tokenState().expiresAt, error: ringError() || undefined })}\n\n`)
    addClient(reply.raw)
    reply.hijack()
  })

  app.get('/api/setup/status', async () => {
    // Only a linked app has a Ring-side subscription or trial; the Playground and simulator don't.
    const subscription = ringMode() === 'linked' ? await ringSubscriptions().then((s) => s.find((x) => x.status === 'active') ?? null).catch(() => null) : null
    return { mode: ringMode(), tokenExpiresAt: tokenState().expiresAt, accountLinked: tokenState().mode === 'linked', devices: devices.all(), subscription, error: ringError() || undefined }
  })

  app.post('/api/setup/token', async (req, reply) => {
    const { token } = (req.body ?? {}) as { token?: string }
    if (!token || token.trim().length < 20) return reply.code(400).send({ ok: false, devices: [], error: 'Paste the access token from the Ring Developer Playground' })
    usePlaygroundToken(token.replace(/^Bearer\s+/i, ''))
    setSetting('history_baseline', {})
    try {
      const list = await refreshDevices()
      void pollHistory()
      return { ok: true, devices: list }
    } catch (err) {
      clearToken()
      await refreshDevices().catch(() => undefined)
      return reply.code(400).send({ ok: false, devices: [], error: `Ring didn't accept that token (${(err as Error).message})` })
    }
  })

  app.post('/api/checkin', async (req) => checkIn(String((req.body as { code?: string })?.code ?? '')))
  // Lets the aide's check-in page greet them by first name before they tap (nothing else is exposed).
  app.get('/api/checkin/:code', async (req, reply) => {
    const code = (req.params as { code: string }).code.toLowerCase()
    const s = schedules.all().find((x) => x.checkinCode?.toLowerCase() === code)
    return s ? { who: s.who.split(/[ (]/)[0], parentName: household.get().parentName } : reply.code(404).send({ error: 'Unknown link' })
  })

  app.get('/api/media/:file', (req, reply) => {
    const file = (req.params as { file: string }).file
    if (!/^[a-zA-Z0-9_.-]+\.jpg$/.test(file)) return reply.code(400).send()
    const path = join(config.dataDir, 'media', file)
    if (!existsSync(path)) return reply.code(404).send()
    reply.header('Cache-Control', 'private, max-age=86400')
    return reply.type('image/jpeg').send(createReadStream(path))
  })

  // Offline simulator controls (only when no real Ring connection is configured).
  app.post('/api/sim/event', async (req, reply) => {
    if (ringMode() !== 'offline_sim') return reply.code(409).send({ error: 'The simulator is only available when Homebeat is not connected to Ring' })
    const { action } = (req.body ?? {}) as { action?: SimAction }
    if (!action) return reply.code(400).send({ error: 'Missing action' })
    const e = simulate(action)
    void pollHistory()
    return { ok: true, eventId: e.id }
  })

  // For judges and the friction log: the last Ring API calls (method, path, status, latency).
  app.get('/api/debug/ring-calls', async () => apiLog.slice(-100).reverse())

  if (process.env.DEMO === '1') {
    app.post('/api/demo/reset', async (req) => {
      resetForDemo({ aideInMinutes: Number((req.body as { aideInMinutes?: number })?.aideInMinutes ?? 2) })
      return { ok: true }
    })
  }
}

async function closeLive(sessionId: string) {
  const s = live.get(sessionId)
  if (!s) return
  live.delete(sessionId)
  clearTimeout(s.timer)
  noteOwnLive(s.deviceId, s.startedAt, Date.now())
  await api().whepClose(s.location)
}
