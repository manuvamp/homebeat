// Ring-facing endpoints registered in the Ring Developer Portal: Webhook URL, Token Exchange URL,
// Account Link URL. None of these are called by the Homebeat web app.
import type { FastifyInstance } from 'fastify'
import { createMoment } from '../care/moments.ts'
import { config } from '../config.ts'
import { ingest } from '../ingest.ts'
import { checkFreshness, completeLink, exchangeCode, previewForNonce } from '../ring/linking.ts'
import { refreshDevices } from '../ring/index.ts'
import { firstDelivery, verifySignature, type WebhookPayload } from '../ring/webhook.ts'
import { devices } from '../store.ts'

export async function ringRoutes(app: FastifyInstance) {
  // Webhooks need the exact bytes Ring signed, so this scope parses JSON as a raw Buffer.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

    scope.post('/ring/webhook', async (req, reply) => {
      const raw = req.body as Buffer
      const insecure = process.env.HOMEBEAT_WEBHOOK_INSECURE === '1'
      if (!insecure && !verifySignature(config.ring.hmacKey, raw, req.headers['x-signature'] as string | undefined)) {
        return reply.code(401).send({ error: 'Invalid signature' })
      }
      let payload: WebhookPayload
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON' })
      }
      // Acknowledge first (Ring's limit is 5 s); all real work happens after the response.
      reply.code(200).send({ ok: true })
      if (!firstDelivery(payload.meta?.request_id)) return
      setImmediate(() => handleWebhook(payload))
    })
  })

  // Token Exchange URL: Ring POSTs the authorization code server-to-server. It is valid for 60 s.
  app.post('/ring/token-exchange', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>
    const code = body.code ?? body.authorization_code
    if (!code) return reply.code(400).send({ error: 'Missing authorization code' })
    try {
      await exchangeCode(code)
      return { ok: true }
    } catch (err) {
      req.log.error(err)
      return reply.code(502).send({ error: 'Token exchange failed' })
    }
  })

  // Account Link URL: the user arrives with ?nonce=&time= from the Ring app.
  app.get('/ring/link', async (req, reply) => {
    const { nonce = '', time = '' } = req.query as { nonce?: string; time?: string }
    const stale = checkFreshness(time)
    const preview = stale ? null : previewForNonce(nonce, time)
    reply.type('text/html').send(linkPage({ nonce, time, email: preview?.email, name: preview?.name, error: stale ?? undefined }))
  })

  app.post('/ring/link', async (req, reply) => {
    const { nonce = '', time = '', email = '' } = (req.body ?? {}) as Record<string, string>
    try {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter your email address.')
      await completeLink(nonce, time, email)
      await refreshDevices().catch(() => undefined)
      return reply.redirect('/welcome')
    } catch (err) {
      return reply.type('text/html').send(linkPage({ nonce, time, email, error: (err as Error).message }))
    }
  })
}

function handleWebhook(p: WebhookPayload) {
  const type = p.data?.type
  const a = p.data?.attributes ?? {}
  const deviceId = String(a.source ?? '')
  const at = Number(a.timestamp) || Date.now()
  switch (type) {
    case 'motion_detected':
    case 'button_press':
      ingest({
        id: p.data?.id ?? `${deviceId}_${type}_${at}`,
        deviceId,
        at,
        kind: type === 'button_press' ? 'ding' : 'motion',
        // Open vocabulary: keep whatever Ring sends (motion, human, vehicle, package_delivery, other_motion, ...)
        subType: type === 'button_press' ? 'ding' : String(a.sub_type ?? 'motion'),
        source: 'webhook',
        requestId: p.meta?.request_id,
        componentIds: a.component_ids,
      })
      break
    case 'device_offline': {
      const d = devices.get(deviceId)
      // device_offline lags real connectivity loss, so this is a note, not an alarm.
      if (d) createMoment({ kind: 'system', severity: 'note', at, deviceId, deviceName: d.name, title: `${d.name} is offline`, body: 'Homebeat can’t see this camera right now. Check its Wi-Fi or battery in the Ring app.' })
      void refreshDevices().catch(() => undefined)
      break
    }
    case 'device_added':
    case 'device_removed':
    case 'device_online':
    case 'app_integration_added':
      void refreshDevices().catch(() => undefined)
      break
    default:
      break
  }
}

const esc = (s = '') => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// Passwordless linking (UX guide): one field, pre-filled from the Users API, one button.
function linkPage(p: { nonce: string; time: string; email?: string; name?: string; error?: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Homebeat</title><style>
body{margin:0;font:17px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#FBF7F1;color:#1E2622;display:grid;place-items:center;min-height:100vh}
main{width:min(420px,92vw);background:#fff;border-radius:20px;padding:32px;box-shadow:0 8px 30px rgba(60,40,10,.08)}
h1{font:600 26px/1.2 Georgia,serif;margin:0 0 8px}p{margin:0 0 16px;color:#4A5A55}
label{display:block;font-weight:600;margin:16px 0 6px}input{width:100%;box-sizing:border-box;padding:14px;border:1.5px solid #CFC8BC;border-radius:12px;font-size:17px}
input:focus-visible{outline:3px solid #1F5C4E;outline-offset:2px}button{margin-top:20px;width:100%;padding:15px;border:0;border-radius:12px;background:#1F5C4E;color:#fff;font-size:17px;font-weight:600;cursor:pointer}
.err{background:#F8E1DC;color:#8E2A1D;padding:12px 14px;border-radius:12px;margin-bottom:12px}.small{font-size:14px;color:#6B7570;margin-top:14px}</style></head>
<body><main><h1>Almost there${p.name ? `, ${esc(p.name.split(' ')[0])}` : ''}</h1>
<p>Create your Homebeat account to finish connecting your Ring devices. This is separate from your Ring account.</p>
${p.error ? `<div class="err" role="alert">${esc(p.error)}</div>` : ''}
<form method="post" action="/ring/link"><input type="hidden" name="nonce" value="${esc(p.nonce)}"><input type="hidden" name="time" value="${esc(p.time)}">
<label for="email">Your email</label><input id="email" name="email" type="email" autocomplete="email" required value="${esc(p.email)}">
<button type="submit">Create account and connect</button></form>
<p class="small">We filled in the email on your Ring account. No password needed: you'll sign in with a one-time code.</p></main></body></html>`
}
