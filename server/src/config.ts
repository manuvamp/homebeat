import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Minimal .env loader (KEY=value lines) so the project runs without extra dependencies.
for (const file of [join(ROOT, '.env'), join(ROOT, 'server', '.env')]) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    const value = m[2].replace(/^["']|["']$/g, '')
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

const env = (key: string, fallback = '') => process.env[key]?.trim() || fallback

export type AiProvider = 'openai' | 'anthropic' | 'bedrock' | 'none'

export const config = {
  port: Number(env('PORT', '8787')),
  publicUrl: env('PUBLIC_URL', 'http://localhost:8787'),
  dataDir: resolve(ROOT, env('DATA_DIR', 'data')),

  ring: {
    apiBase: env('RING_API_BASE', 'https://api.amazonvision.com'),
    oauthBase: env('RING_OAUTH_BASE', 'https://oauth.ring.com'),
    // Playground mode: a 30-minute token from developer.amazon.com/ring/console/playground
    accessToken: env('RING_ACCESS_TOKEN'),
    // Linked mode: long-lived integration from account linking
    refreshToken: env('RING_REFRESH_TOKEN'),
    clientId: env('RING_CLIENT_ID'),
    clientSecret: env('RING_CLIENT_SECRET'),
    hmacKey: env('RING_HMAC_KEY'),
    // Event History polling: the Playground has no webhook URL, so we poll in that mode.
    pollMs: Number(env('RING_POLL_MS', '4000')),
    // Force the offline simulator (no Ring account at all). Clearly labelled in the UI.
    forceSim: env('HOMEBEAT_SIM') === '1',
  },

  ai: {
    provider: env('AI_PROVIDER', 'openai') as AiProvider,
    baseUrl: env('AI_BASE_URL', 'http://127.0.0.1:8317/v1'),
    apiKey: env('AI_API_KEY'),
    visionModel: env('AI_VISION_MODEL', 'claude-haiku-5-5'),
    textModel: env('AI_TEXT_MODEL', 'claude-haiku-5-5'),
    anthropicKey: env('ANTHROPIC_API_KEY_HOMEBEAT'),
    awsRegion: env('AWS_REGION', 'us-east-1'),
    bedrockModel: env('BEDROCK_MODEL_ID', 'us.anthropic.claude-haiku-4-5-20251001-v1:0'),
    // Price per vision call used by the cost meter (USD). Haiku-class model, one 1280px frame + short JSON.
    visionCallUsd: Number(env('AI_VISION_CALL_USD', '0.0021')),
  },

  cv: {
    stage1: env('CV_STAGE1', 'on') !== 'off',
    stage2: env('CV_STAGE2', 'on') !== 'off',
  },

  household: {
    timezone: env('HOUSEHOLD_TZ', 'America/Los_Angeles'),
    seedSample: env('SEED_SAMPLE', '1') === '1',
  },
}

export type Config = typeof config
