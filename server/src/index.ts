import { existsSync } from 'node:fs'
import { join } from 'node:path'
import formbody from '@fastify/formbody'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { checkQuiet } from './care/engine.ts'
import { runDueJobs } from './care/jobs.ts'
import { pruneOldData } from './care/retention.ts'
import { seedIfEmpty } from './care/seed.ts'
import { tickVisits } from './care/visits.ts'
import { config, ROOT } from './config.ts'
import { pollHistory } from './ingest.ts'
import { warmUp } from './pipeline/localVision.ts'
import { refreshDevices, ringMode } from './ring/index.ts'
import { apiRoutes } from './routes/api.ts'
import { ringRoutes } from './routes/ring.ts'

// Real Ring device IDs are ~120 characters; Fastify's default 100-character param limit would answer 414.
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 2 * 1024 * 1024, routerOptions: { maxParamLength: 512 } })
await app.register(formbody)
await app.register(ringRoutes)
await app.register(apiRoutes)

const dist = join(ROOT, 'web', 'dist')
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, wildcard: true })
  // Single-page app: any non-API route serves index.html.
  app.setNotFoundHandler((req, reply) => {
    if (/^\/(api|ring|assets)\//.test(req.url)) return reply.code(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })
}

seedIfEmpty()
try {
  await refreshDevices()
} catch (err) {
  console.warn(`[ring] device discovery failed: ${(err as Error).message}`)
}
warmUp()

// Background loops: visit windows + quiet-day check every 20 s, delayed jobs every 3 s,
// Event History polling when there is no webhook (Playground and simulator).
setInterval(() => {
  tickVisits()
  checkQuiet()
}, 20_000)
setInterval(() => void runDueJobs(), 3_000)
setInterval(() => {
  if (ringMode() !== 'linked') void pollHistory()
}, config.ring.pollMs)
tickVisits()
pruneOldData()
setInterval(() => pruneOldData(), 6 * 3600_000)

await app.listen({ port: config.port, host: '0.0.0.0' })
console.log(`Homebeat on http://localhost:${config.port}  (Ring: ${ringMode()}, AI: ${config.ai.provider})`)
