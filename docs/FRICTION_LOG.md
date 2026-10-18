# Friction log: building Homebeat on the Ring Partner API

Written while building, October 19-23 2026. Each entry: task, steps, expected vs. actual, severity,
workaround, suggestion. Severity: **High** blocks or risks certification, **Medium** costs hours or forces a
guess, **Low** papercut.

---

### 1. Finding the simulator: the Playground is hard to discover
- **Task:** build for Ring without owning a Ring device (the hackathon says no device is needed).
- **Steps:** read Get Started, the Ring API docs and the Develop guide looking for a sandbox or simulator.
- **Expected:** a "no device? start here" pointer to the Ring Developer Playground.
- **Actual:** Get Started lists "At least one Ring device for testing" as a requirement. The API docs never
  mention the Playground; the glossary defines a "Sandbox Environment … with synthetic Ring devices" without a
  link. I found the Playground only in the May 28 2026 release notes and in the sample app's README.
- **Severity:** Medium (anyone without a device may give up before they start).
- **Workaround:** release notes → Playground.
- **Suggestion:** link the Playground from Get Started and the top of the API docs ("No Ring device? Generate a
  token in the Playground"), and say what it simulates (Package, Vehicle, Motion events; WHEP live view).

### 2. The two account-linking docs disagree about the sign-in form
- **Task:** build the Account Link URL page.
- **Steps:** read One-Way Account Linking and the UX design guide.
- **Expected:** one recommended pattern.
- **Actual:** the linking docs say the page "must present a sign-in or create-account form" and "Do not build
  this as an automatic nonce-verification endpoint". The UX guide recommends "Passwordless account linking
  (recommended)… eliminate the signup form entirely… zero input required."
- **Severity:** High (it's unclear which one certification enforces).
- **Workaround:** a single email field pre-filled from `GET /v1/users/me` and one "Create account and connect"
  button: the user explicitly confirms an account, with no password and no verification code.
- **Suggestion:** reconcile the two pages and state what certification accepts.

### 3. Token Exchange URL request format is only in the MCP knowledge base
- **Task:** implement the Token Exchange URL.
- **Steps:** searched the website docs for the request Ring sends.
- **Expected:** content type and field names.
- **Actual:** the website only says "Ring POSTs the authorization code". The Ring Appstore MCP server's copy of
  the same page has a section 5.3 ("form-encoded… the `code` field") that the website doesn't.
- **Severity:** Medium.
- **Workaround:** asked the Ring MCP server; accept form-encoded `code`.
- **Suggestion:** publish section 5.3 on the website; add a "docs parity" check between the site and the MCP
  knowledge base.

### 4. Ring MCP server tool names differ from the docs
- **Task:** query the Ring Appstore MCP server from a script.
- **Steps:** called `search_docs` as documented.
- **Expected:** results.
- **Actual:** `Unknown tool: search_docs`; the server exposes `ring___search_docs` and `ring___get_doc`
  (gateway prefix).
- **Severity:** Low (IDE clients list tools, scripts break).
- **Suggestion:** document the prefixed names or alias the plain ones.

### 5. Event History has no sub_type, and its vocabulary differs from webhooks
- **Task:** poll Event History (the Playground has no webhook URL) and treat events like webhooks.
- **Steps:** `GET /v1/history/devices/{id}/events`.
- **Expected:** the same classification webhooks carry in `attributes.sub_type`.
- **Actual:** history returns `event_type` only; sub-types exist only as filters
  (`event_types=motion.human`). History documents `human, vehicle, animal, other_motion`; webhooks document
  `human, vehicle, package_delivery, other_motion` (no `animal`, no `package_delivery` in the other list).
- **Severity:** Medium (one extra request per sub-type whenever new events appear).
- **Workaround:** when new motion events show up, one filtered query per sub-type to label them.
- **Suggestion:** return `sub_type` on history events and use one vocabulary in both places.

### 6. Snapshots right after an event: 416 is only explained in the MCP knowledge base
- **Task:** download the frame for a fresh motion event.
- **Actual:** the website explains the two-step 303 flow but not that a just-finished event may have no media
  yet (`416 MEDIA_NOT_FOUND`) or that `at_timestamp` has ±10 s tolerance; both are in the MCP copy.
- **Severity:** Medium.
- **Workaround:** retry at 3 s, 6 s, 10 s, alternating `at_timestamp` and `latest_in_range`.
- **Suggestion:** document the 416 case and a recommended delay on the website; a `media_ready` field on the
  webhook or history event would remove the guessing.

### 7. No device type, no power source
- **Task:** show "Front Door (doorbell)" vs "Driveway (camera)" and the right live-view limit.
- **Actual:** device attributes are only `name` and `image_url` (and docs say not to parse `image_url`). Live
  sessions last 30 s on battery and 60 s on wired devices, but no field says which a device is.
- **Severity:** Low-Medium.
- **Workaround:** chime by capability; doorbell vs camera by name; battery percentage present → 30 s.
- **Suggestion:** add `device_family` and `power_source` (or `max_live_seconds`) to the device or status.

### 8. Official sample: live view offers `sendrecv` audio
- **Task:** reuse `useWebRTCStream` from `ring-api-helloworld`.
- **Actual:** it adds the audio transceiver as `sendrecv`, while the WHEP docs say all tracks must be
  `recvonly` and bidirectional media isn't supported.
- **Severity:** Low.
- **Workaround:** `recvonly` for both tracks in Homebeat.
- **Suggestion:** fix the sample (Homebeat's Open Source contribution, see README).

### 9. Playground tokens last 30 minutes
- **Task:** leave Homebeat running against Playground devices during a demo.
- **Actual:** the token expires after 30 min with no refresh, so a long-running app stops mid-session.
- **Severity:** Low (fine for exploring, painful for apps that poll).
- **Workaround:** Settings → "Paste a new token", with a countdown in the UI.
- **Suggestion:** longer Playground tokens or a Playground refresh token.

### 10. Chime slots can't carry a message
- **Task:** remind the parent that a delivery is waiting.
- **Actual:** playback is limited to the app's fixed slots; slot audio can't be set through the API, so the
  chime can play a tone but not "There's a package at your front door."
- **Severity:** Low (feature gap, documented as early access).
- **Suggestion:** let partners upload short slot audio (or TTS) with user approval.

<!-- More entries are added as they come up while testing against the Playground. -->
