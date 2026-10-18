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

## Testing against the Ring Developer Playground (October 18-19)

### 11. The Playground's simulated events are live views, not motion events
- **Task:** drive Homebeat's event pipeline from the Playground's "Simulate live view event" buttons.
- **Steps:** clicked Package, Vehicle and Motion, then polled `GET /v1/history/devices/{id}/events`.
- **Expected:** a motion (or ding) event with a `sub_type` (`package_delivery`, `vehicle`, ...), ideally
  delivered to a webhook.
- **Actual:** each click links a sample clip to the single "Playground Device" and opens a WHEP session. History
  then shows one `on_demand` event (`start`/`end` = the clip length, `is_third_party_reviewed: true`, empty
  `cv_detections`). There is no sub_type, no webhook, and no way to simulate a doorbell press or a person at the
  door; the "Motion" clip is birds at a feeder.
- **Severity:** Medium (the main thing a Ring app reacts to, a classified motion or ding event, can't be tested).
- **Workaround:** in Playground mode Homebeat treats `on_demand` events it didn't open itself as unlabelled
  motion and lets its CV funnel classify the frames (package → delivery, car → visit evidence, birds → dropped).
- **Suggestion:** a "Simulate motion event" control that emits real `motion_detected` / `ding` events with a
  chosen `sub_type`, to history and to a configurable webhook URL.

### 12. A Playground token can't read media from before it was issued
- **Task:** fetch a frame for an event a few minutes old.
- **Actual:** `latest_in_range` with a start before the token's `iat` answers
  `403 TIME_RANGE_NOT_AUTHORIZED` ("Requested time range is not within authorized boundaries"), and so does
  `at_timestamp` for an earlier moment. Not documented.
- **Severity:** Low-Medium (looks like a permissions bug until you compare timestamps with the JWT).
- **Workaround:** clamp snapshot ranges to the token's `iat`.
- **Suggestion:** document the media time window per token type.

### 13. A fractional timestamp is reported as an authorization failure
- **Task:** download the frame a third of the way into an event (`start + duration × 0.3`).
- **Actual:** `{"timestamp": 1792357117032.2}` answers `403 REQUEST_FORBIDDEN` "Cannot authorize: invalid
  request body". The same request with an integer timestamp returns the 303.
- **Severity:** Medium (a 403 sends you to check tokens and scopes, not the body; cost me a restart cycle).
- **Workaround:** round every timestamp before sending.
- **Suggestion:** return `400` with the field name for body validation errors.

### 14. The Playground device went offline mid-session, silently
- **Task:** run the same simulation a fourth time, about 14 minutes after generating the token.
- **Actual:** the device status flipped to `online: false` (`reported_at` 21:09:22Z); the Playground still
  created WHEP sessions (201) and history events, but the video was black and every frame request was
  `416 MEDIA_NOT_FOUND`. The Playground page showed no offline state, and the token couldn't be regenerated
  until it expired.
- **Severity:** Medium (looks like an app bug; the first three runs had worked).
- **Workaround:** check `device-status.online` before simulating; generate a new token after expiry.
- **Suggestion:** show device status on the Playground page and allow re-provisioning without waiting for expiry.

### 15. `latest_in_range` over a span with no media leaks an internal error
- **Actual:** `422 GRECO_NO_VALID_KEY` "No valid Greco key available for decryption" for an unencrypted device,
  where `at_timestamp` for the same span answers `416 MEDIA_NOT_FOUND`.
- **Severity:** Low.
- **Workaround:** treat 422 like 416 (retry later, then give up).
- **Suggestion:** return 416 consistently.

### 16. No way to test chimes or subscriptions in the Playground
- **Actual:** the Playground Device has `audio.customizable_slots: null` and there's no simulated chime, so chime
  playback can't be exercised (a test call answers `400 Validation Error`). `GET /v1/accounts/me/subscriptions`
  answers `422` "Unable to process subscription request for this user".
- **Severity:** Low.
- **Workaround:** Homebeat's offline simulator has a Hallway Chime with two slots.
- **Suggestion:** a simulated chime (and a test subscription) on the Playground account.

**Confirmed against the live API:** device attributes are only `name` and `image_url` (entry 7); `online` lives in
`device-status`, not on the device (sample-app note in [FEEDBACK.md](FEEDBACK.md)); privacy zones are under
`image_enhancements.privacy_zones`; the WHEP `Location` header carries a `?location=` query that the `DELETE`
must keep; image and clip downloads are a 303 to a pre-signed host (fetched without the Bearer header).
