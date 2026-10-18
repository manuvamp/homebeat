# Homebeat web

React 19 + TypeScript + Tailwind v4 PWA for Homebeat (Ring Appstore partner app). Types come from `../shared/types.ts` via the `@shared` alias.

## Run

```bash
npm install
npm run dev        # real mode: proxies /api and /c to http://localhost:8787 (override with HOMEBEAT_API)
npm run dev:mock   # mock mode (VITE_MOCK=1 from .env.mock), no backend needed
npm run build      # tsc + vite build into dist/
```

## Mock mode

- Turn it on with `VITE_MOCK=1` (or `npm run dev:mock`). The app also falls back to mock data on its own when `GET /api/today` fails at startup (no server, 5xx, or HTML from a static host). The header then says "Sample data".
- Fixtures live in `src/mock/fixtures.ts`. They hold 7 days of history: visits that were on time, late or missed, deliveries, after-dark moments, a quiet day and a system notice. Every record has `sample: true`. `src/mock/api.ts` implements the whole API in memory.
- The demo clock is pinned to 2:20 PM on the most recent Mon/Wed/Fri in Asha's timezone, so the sample day always includes Maria's visit and the lunch delivery.
- The header has a **Simulate event** button that pushes a fake moment through the stream. Use it to see the arrival animation, the toast and the `aria-live` announcement.
- Live view plays a simulated canvas feed in mock mode. In real mode it uses WHEP through `POST /api/live/:deviceId`.
- Snapshot placeholders are hand-drawn SVGs in `public/placeholders/`.

## Layout

- `src/lib/api.ts`: the typed client (`HomebeatApi`), real HTTP + SSE, and the mock/real switch.
- `src/lib/store.tsx`: the app state, stream merge, toasts and live-region announcements.
- `src/lib/time.ts`: household-timezone formatting.
- `src/pages/*`: one file per screen.
- `src/components/*`: hand-built UI (no UI kit).
