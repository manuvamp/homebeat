// Evaluates the CV funnel on labelled doorstep frames and compares it with "send every frame to the
// vision model". Writes server/eval/results.json and prints a table.
//
//   npx tsx scripts/eval.ts            (uses AI_PROVIDER etc. from .env)
//
// Cases live in server/eval/cases.json: { file, subType, kind, afterDark?, expect: { visitorType?, activity?,
// package?, vehicle?, stop? } }. Images are server/assets/sim/*.jpg (generated scenes for the offline
// simulator) or server/eval/frames/*.jpg (real frames from the Ring Developer Playground, `origin` set).
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HOMEBEAT_DB = join(mkdtempSync(join(tmpdir(), 'hb-eval-')), 'eval.db')
const { ROOT, config } = await import('../src/config.ts')
const { runFunnel } = await import('../src/pipeline/funnel.ts')
const { askJson } = await import('../src/ai/provider.ts')

interface Case {
  file: string
  subType: string
  kind?: 'motion' | 'ding'
  afterDark?: boolean
  origin?: 'playground_live'
  expect: { visitorType?: string; activity?: string; package?: boolean; vehicle?: boolean; stop?: boolean }
}

const cases: Case[] = JSON.parse(readFileSync(join(ROOT, 'server', 'eval', 'cases.json'), 'utf8'))
const imagePath = (f: string) => [join(ROOT, 'server', 'eval', 'frames', f), join(ROOT, 'server', 'assets', 'sim', f)].find(existsSync)

const device = { id: 'eval-door', name: 'Front Door', kind: 'doorbell' as const, online: true }
const schedule = {
  id: 's_aide', label: 'Home aide', who: 'Maria (BrightCare)', visitorType: 'care_worker' as const, days: [0, 1, 2, 3, 4, 5, 6],
  windowStart: '00:00', windowEnd: '23:59', graceMin: 30, expectedMinutes: 55, vehicleHint: 'silver hatchback', active: true,
}

function judge(c: Case, v: { visitorType?: string; activity?: string; packagePresent?: boolean; vehicle?: string | null } | null) {
  const e = c.expect
  if (e.stop) return v === null
  if (!v) return false
  if (e.visitorType && v.visitorType !== e.visitorType) return false
  if (e.activity && v.activity !== e.activity) return false
  if (e.package !== undefined && Boolean(v.packagePresent) !== e.package) return false
  if (e.vehicle && !v.vehicle) return false
  return true
}

const rows: Record<string, unknown>[] = []
let funnelCost = 0
let naiveCost = 0
let funnelOk = 0
let naiveOk = 0
for (const [i, c] of cases.entries()) {
  const path = imagePath(c.file)
  if (!path) {
    console.warn(`skip ${c.file}: image missing`)
    continue
  }
  const jpeg = readFileSync(path)
  const out = await runFunnel(
    { id: `eval_${i}`, deviceId: device.id, at: Date.now() - i * 60_000, kind: c.kind ?? 'motion', subType: c.subType, source: c.origin ? 'history' : 'sim', origin: c.origin },
    {
      device,
      afterDark: Boolean(c.afterDark),
      openVisits: [{ visit: { id: 'v', scheduleId: 's_aide', label: 'Home aide', who: schedule.who, date: '', expectedStart: 0, expectedEnd: 0, status: 'due', evidence: [] }, schedule }],
      inProgress: [],
      packageOutstanding: false,
      watchVehicles: true,
      customQuestions: [],
      frame: async () => ({ jpeg, url: '' }),
    },
  )
  const ok = judge(c, out.verdict)
  funnelOk += ok ? 1 : 0
  funnelCost += out.analysis.totalCostUsd
  const reached = Math.max(...out.analysis.stages.filter((s) => s.ran).map((s) => s.stage))

  // Baseline: the same frame straight to the vision model, every time.
  let naive: { visitor_type?: string; activity?: string; package_present?: boolean; vehicle?: string | null } | null = null
  if (config.ai.provider !== 'none') {
    naive = await askJson({
      system: 'You look at one doorbell camera frame. Ignore watermarks. Never identify faces.',
      prompt: 'Return only JSON {"visitor_type": "care_worker"|"delivery"|"family"|"service"|"unknown"|"resident"|"none", "activity": "arriving"|"leaving"|"waiting"|"passing"|"delivering"|"collecting"|"unknown", "package_present": bool, "vehicle": string|null}.',
      images: [{ bytes: jpeg, mediaType: 'image/jpeg' }],
      maxTokens: 200,
    }).catch(() => null)
    naiveCost += config.ai.visionCallUsd
    // Judged like the funnel: "nothing here" only when the model sees no person, no package and no vehicle.
    const nothing = naive && naive.visitor_type === 'none' && !naive.package_present && !naive.vehicle
    const nv = naive && !nothing ? { visitorType: naive.visitor_type === 'none' ? undefined : naive.visitor_type, activity: naive.activity, packagePresent: naive.package_present, vehicle: naive.vehicle } : naive ? null : undefined
    naiveOk += nv !== undefined && judge(c, nv) ? 1 : 0
  }
  rows.push({
    file: c.file,
    realRing: Boolean(c.origin),
    subType: c.subType,
    expected: c.expect,
    reachedStage: reached,
    stages: out.analysis.stages.map((s) => ({ stage: s.stage, ran: s.ran, ms: s.ms, summary: s.summary })),
    verdict: out.verdict,
    ok,
    ms: out.analysis.totalMs,
    costUsd: out.analysis.totalCostUsd,
  })
  console.log(`${ok ? 'OK ' : 'MISS'} ${c.file.padEnd(26)} ${c.subType.padEnd(16)} stage ${reached}  ${String(out.analysis.totalMs).padStart(5)} ms  ${out.verdict ? `${out.verdict.visitorType ?? '-'} / ${out.verdict.activity ?? '-'}` : 'stopped'}`)
}

const n = rows.length
const reachedVision = rows.filter((r) => r.reachedStage === 3).length
const real = rows.filter((r) => r.realRing)
const summary = {
  cases: n,
  realRingFrames: { cases: real.length, correct: real.filter((r) => r.ok).length, visionCalls: real.filter((r) => r.reachedStage === 3).length },
  funnel: { correct: funnelOk, accuracy: n ? funnelOk / n : 0, visionCalls: reachedVision, costUsd: funnelCost, avgMs: n ? Math.round(rows.reduce((s, r) => s + (r.ms as number), 0) / n) : 0 },
  everyFrameToVision: config.ai.provider !== 'none' ? { correct: naiveOk, accuracy: n ? naiveOk / n : 0, visionCalls: n, costUsd: naiveCost } : null,
  model: config.ai.provider === 'bedrock' ? config.ai.bedrockModel : config.ai.visionModel,
  at: new Date().toISOString(),
}
writeFileSync(join(ROOT, 'server', 'eval', 'results.json'), JSON.stringify({ summary, rows }, null, 2))
console.log('\n' + JSON.stringify(summary, null, 2))
