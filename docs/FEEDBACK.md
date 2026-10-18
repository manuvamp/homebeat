# Product feedback

For each tool: what Homebeat used it for, what worked, what needs work, onboarding, and whether I'd build with
it again. Detailed reproduction steps are in [FRICTION_LOG.md](FRICTION_LOG.md).

## Ring Partner API (api.amazonvision.com)

- **Used for:** device discovery with `include`, status/capabilities/configurations, Event History with
  composite filters, image snapshots, clips, WHEP live view, chime playback, Users API, app-integrations,
  subscriptions, OAuth token exchange/refresh, webhooks.
- **Worked well:** JSON:API with `?include=` gets everything for the device list in one round trip. The
  two-step media flow (303 to a pre-signed URL) is simple once you know not to send the Bearer header to the
  pre-signed host. WHEP is standard: a browser `RTCPeerConnection` plus a ten-line server proxy is a working
  live view. The webhook signing and nonce designs are clear and testable, and the docs explain *why* (the
  "Why One-Way Account Linking Is Designed the Way It Is" section is excellent).
- **Needs work:** Event History has no `sub_type`, and its sub-type vocabulary differs from webhooks; no
  device family or power source on the device; snapshot readiness (`416 MEDIA_NOT_FOUND`) is only explained in
  the MCP knowledge base. See friction log entries 5-7.
- **Would I build with it again:** yes. The API surface is small and predictable, and the care use case
  needs exactly what it offers: events, a frame, a live view, and a way to make a sound in the home.

## Ring Developer Playground

_Filled in after testing with the Playground._

## Ring Appstore docs (Get Started, API docs, UX design guide, Computer Vision Guidelines)

- **Used for:** the whole build. The **Computer Vision Guidelines** shaped Homebeat's architecture: the tiered
  funnel, open-vocabulary `sub_type` handling, "acknowledge the webhook, process later", designing around the
  watermark and encrypted devices, and closing the loop with user feedback. It's the best platform CV guidance
  I've read. The **UX design guide** gave concrete patterns (passwordless linking, confirmation screen, Ring app
  guidance cards) that went straight into the product.
- **Needs work:** the API reference is one very long page, so section anchors and the repeated table of
  contents make it hard to navigate and to search; the linking docs and UX guide contradict each other on the
  sign-in form (friction #2); Get Started says a Ring device is required and doesn't mention the Playground
  (friction #1).
- **Onboarding:** reading to first working call took about an hour, most of it finding the Playground.

## Ring Appstore MCP server (knowledge.appstore-mcp.ring.amazon.dev)

- **Used for:** resolving questions the website didn't answer: the Token Exchange request format and snapshot
  readiness. It answered both, with sources.
- **Worked well:** no auth needed, fast, and it holds content the website lacks.
- **Needs work:** tool names are `ring___search_docs` / `ring___get_doc`, not the documented `search_docs` /
  `get_doc`; and the website and the knowledge base have drifted apart (friction #3, #4).
- **Would I use it again:** yes, it's the fastest way to the right paragraph.

## ring-api-helloworld sample

- **Used for:** the WHEP proxy pattern and token modes.
- **Worked well:** small, readable, shows both Playground and refresh-token modes.
- **Needs work:** the WebRTC hook offers `sendrecv` audio although WHEP is `recvonly` only; the device route
  reads `online` from the device resource, where it doesn't live (it's in `device-status`).

## Feature requests

| Request | Why it matters for Homebeat | Urgency |
|---|---|---|
| `sub_type` on Event History events, one sub-type vocabulary everywhere | Polling apps (and the Playground) can't classify events without N extra queries | Important |
| `device_family` and `power_source` (or `max_live_seconds`) | Correct labels and live-view limits without guessing from names | Important |
| Partner-supplied chime audio (short clip or TTS, user-approved) | "There's a package at your front door" for the parent, not just a tone | Important |
| Two-way talk for partners (WHEP `sendrecv` or a talk endpoint) | Family can speak to a visitor at the parent's door from the care app | Nice-to-have |
| Longer Playground tokens or a Playground refresh token | Long-running apps keep working during a demo | Nice-to-have |
| A `media_ready` signal on motion events | Download the frame exactly when it exists instead of retrying on 416 | Nice-to-have |
