# Homebeat HTTP API (served by `server/`, consumed by `web/`)

All shapes are in `shared/types.ts`. JSON in, JSON out. Base path `/api`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/today` | | `TodaySummary` |
| GET | `/api/moments?date=YYYY-MM-DD` | | `Moment[]` (newest first) |
| POST | `/api/moments/:id/ack` | `{ by: string }` | `Moment` |
| POST | `/api/moments/:id/feedback` | `{ feedback: 'right' \| 'wrong' }` | `Moment` |
| POST | `/api/moments/:id/chime` | | `{ ok: boolean, slot?: string, error?: string }` |
| GET | `/api/visits?from=YYYY-MM-DD&to=YYYY-MM-DD` | | `Visit[]` |
| GET | `/api/schedules` | | `Schedule[]` |
| POST | `/api/schedules` | `Omit<Schedule,'id'>` | `Schedule` |
| PUT | `/api/schedules/:id` | `Schedule` | `Schedule` |
| DELETE | `/api/schedules/:id` | | `{ ok: true }` |
| GET | `/api/rules` | | `Rule[]` |
| POST | `/api/rules/compile` | `{ english: string }` | `CompiledRule` |
| POST | `/api/rules` | `{ english: string, compiled: CompiledRule }` | `Rule` |
| PATCH | `/api/rules/:id` | `{ enabled: boolean }` | `Rule` |
| DELETE | `/api/rules/:id` | | `{ ok: true }` |
| GET | `/api/devices` | | `Device[]` |
| POST | `/api/devices/refresh` | | `Device[]` |
| POST | `/api/live/:deviceId` | `{ sdp: string }` | `LiveSessionResponse` |
| DELETE | `/api/live/:sessionId` | | `{ ok: true }` |
| GET | `/api/analysis/:id` | | `Analysis` |
| GET | `/api/funnel?days=30` | | `FunnelStats` |
| GET | `/api/digest?date=YYYY-MM-DD` | | `DailyDigest` |
| GET | `/api/report?weekOf=YYYY-MM-DD` | | `WeeklyReport` |
| GET | `/api/household` | | `Household` |
| PUT | `/api/household` | `Partial<Household>` | `Household` |
| GET | `/api/stream` | | Server-Sent Events, each `data:` is a `StreamMessage` |
| GET | `/api/setup/status` | | `{ mode, tokenExpiresAt?, accountLinked, devices: Device[] }` |
| POST | `/api/setup/token` | `{ token: string }` | `{ ok: boolean, devices: Device[], error?: string }` |
| POST | `/api/checkin` | `{ code: string }` | `{ ok: boolean, who?: string }` |

Ring-facing endpoints (not used by the web app):

| Method | Path | Purpose |
|---|---|---|
| POST | `/ring/webhook` | Ring webhook receiver: verifies `X-Signature` (HMAC-SHA256, hex) on the raw body, answers 200 in < 5 s, queues the event |
| POST | `/ring/token-exchange` | Token Exchange URL: swaps the authorization code within 60 s, keeps the token unclaimed until the nonce matches |
| GET | `/ring/link` | Account Link URL: passwordless linking (nonce HMAC match, Users API email, POST + PATCH app-integrations) |
