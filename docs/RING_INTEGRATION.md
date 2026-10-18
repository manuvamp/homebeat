# How Homebeat uses the Ring Partner API

Every call goes server-to-server to `https://api.amazonvision.com` (Ring blocks browser CORS), through
`server/src/ring/client.ts`. `GET /api/debug/ring-calls` on a running Homebeat shows the last 100 calls with
status and latency.

## Endpoints

| Ring API | What Homebeat does with it | Code |
|---|---|---|
| `GET /v1/devices?include=status,capabilities,configurations,location` | One round trip to list the parent's devices with their status, capabilities and settings (JSON:API `included` matched by `type` + `id`) | `ring/client.ts` `listDevices`, `ring/index.ts` `normalizeDevice` |
| device `status` | Online/offline, battery percentage (ignored outside 0-100, per the sensor guidance) | `normalizeDevice` |
| device `capabilities` | Identifies a chime by `audio.customizable_slots > 0` (the device resource has no type field) | `normalizeDevice` |
| device `configurations` | `e2e_encryption.enabled` (a JSON boolean, unlike the "on"/"off" strings) switches the device to metadata-only moments; motion zones and privacy zones shown in Settings; chime slots sorted by `event` | `normalizeDevice`, `care/engine.ts` `frameFor` |
| `GET /v1/history/devices/{id}/events` (+ `event_types=motion.human,...`) | Polled every 4 s when there is no webhook (Ring Developer Playground, simulator). History has no `sub_type`, so new events are classified with one composite-filter query per sub-type | `ingest.ts` `pollHistory` |
| `POST /v1/devices/{id}/media/image/download` | The frame for each event (`at_timestamp`, Ring applies ±10 s), then `latest_in_range`; 303 redirect followed by hand without the Bearer header; backoff on `416 MEDIA_NOT_FOUND` while the recording uploads. Also the "is the package still outside?" re-check | `client.ts` `snapshot`/`download`, `engine.ts` `frameFor`, `package_check` job |
| `POST /v1/devices/{id}/media/video/download` | Clip download (15 min max, `avc`) | `client.ts` `clip` |
| `POST /v1/devices/{id}/media/streaming/whep/sessions` + `DELETE` session | Live view in the family app: the browser's SDP offer (video + audio, both `recvonly`) is proxied, the `Location` URL kept server-side, and the session closed at the device limit (30 s battery / 60 s wired) even if the tab is forgotten | `routes/api.ts` `/api/live`, `web/src/components/LivePlayer.tsx` |
| `POST /v1/devices/{chime}/media/audio/playback` | A soft tone on the parent's Ring Chime when a delivery sits outside. `audio_ref` is resolved from configurations at play time and never stored | `engine.ts` `playChime` |
| `GET /v1/users/me` | Ring Account ID for nonce matching; email to pre-fill the passwordless account page | `client.ts` `usersMe`, `ring/linking.ts` |
| `POST` + `PATCH /v1/accounts/me/app-integrations` | Completes one-way account linking (`awaiting` → `completed`) with a masked `account_identifier` | `ring/linking.ts` `completeLink` |
| `POST https://oauth.ring.com/oauth/token` | Authorization-code exchange within 60 s; refresh-token rotation one minute before expiry, one refresh in flight | `ring/linking.ts`, `ring/auth.ts` |

## Webhooks (`POST /ring/webhook`)

`server/src/routes/ring.ts`, `server/src/ring/webhook.ts`

- `X-Signature` checked with HMAC-SHA256 (hex, `sha256=` prefix) over the **raw bytes** before any parsing,
  constant-time comparison. The route has its own body parser that keeps the Buffer.
- Answers `200` immediately; all work runs after the response (Ring's limit is 5 s).
- `meta.request_id` stored, so Ring's retries are processed once.
- `motion_detected` keeps `attributes.sub_type` as an open vocabulary (`motion`, `human`, `vehicle`,
  `package_delivery`, `other_motion`, anything new) and `component_ids` for multi-camera devices.
- `button_press` becomes a doorbell event; `device_offline` becomes a calm note ("check Wi-Fi in the Ring app",
  since it lags real connectivity loss); device add/remove/online and `app_integration_added` refresh devices.

## Account linking (one-way, Ring-driven)

1. **Token Exchange URL** `POST /ring/token-exchange`: form-encoded `code`, exchanged right away, token kept
   *unclaimed* under the Account ID from `/v1/users/me`.
2. **Account Link URL** `GET /ring/link?nonce=&time=`: freshness check (600 s window, no future times),
   then a one-field page with the Ring email pre-filled. Both docs are satisfied: the user explicitly confirms an
   account (the linking docs require a sign-in/create step before nonce matching) and there is no password or
   verification code (the UX guide's passwordless pattern).
3. `POST /ring/link`: nonce = base64url(HMAC-SHA256(key, `"<time>:<account_id>"`)) matched against unclaimed
   tokens in constant time, then `POST` + `PATCH app-integrations`, then redirect to `/welcome`, which shows the
   connected devices with online status and the skippable first-visit tour.

Tested in `server/test/ring.test.ts` (signature, re-serialized bodies, request_id dedupe, nonce encoding,
freshness window, device normalization).

## Ring's Computer Vision Guidelines, implemented

`server/src/pipeline/funnel.ts`, measured per event and shown in the app on every moment and on "How Homebeat watches".

| Stage | What runs | Cost |
|---|---|---|
| 0. Ring `sub_type` | Skip list (`animal`), never an allow list; bursts on the same device within 25 s merged; vehicles only processed when a visit with a known car is expected, after dark, or a vehicle rule exists; doorbell presses always processed | free, before any download |
| 1. Object gate | YOLOS-tiny (on-device, ONNX) on one frame: person / vehicle present? Input reduced to 384-640 px (0.5 s on CPU) | free |
| 2. Attire & vehicle match | CLIP zero-shot against plain descriptions ("a home care worker in scrubs carrying a bag", "a silver hatchback"). Resolves clear, low-stakes events; after-dark events and custom rules always go on | free |
| 3. Vision model | Claude on Amazon Bedrock (or the Anthropic API / any OpenAI-compatible endpoint), one frame, JSON verdict, told to ignore the watermark and never identify faces | ~$0.002 |

Also from the guide: webhooks acknowledged before any CV; encrypted (TAKE) devices degrade to metadata-only
moments instead of retrying; frames requested at full resolution so the watermark covers less; every moment
has "Was this right?" feedback stored with its analysis (the labelled set a tuned Stage 2 would train on);
low-confidence results are worded "Looks like…".

## UX design guide

- Uses "Ring app" consistently; never asks the family to change Ring settings inside Homebeat. Settings has
  the "Change motion zones and Smart Alerts in the Ring app" guidance card.
- Account-linked confirmation lists devices with online/offline status, then a skippable 3-step tour with a
  progress indicator and a completion message; revisit from Settings → Help.
- Live view tells the user why it stops ("ends after 30 s to save the doorbell's battery").
- WCAG 2.2 AA: contrast-checked palette, severity always shown by color + icon + text, focus rings, keyboard
  navigation, `aria-live` announcements for new moments, reduced-motion support.
