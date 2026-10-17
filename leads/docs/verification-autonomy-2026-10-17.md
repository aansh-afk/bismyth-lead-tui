# Autonomous outreach verification — 2026-10-17

## Requested behavior and method

Start Agent assesses every allowed relationship, introduces genuinely new prospects once, and answers each new incoming message using that relationship's saved context and stage. No per-message review is needed. Contact discovery/import is still separate from active WhatsApp permission. Stages guide the reply rather than marking future incoming messages as already answered.

Production tests use isolated SQLite stores and an injected socket/transport. A clock and random source make natural delays, burst handling, backoff and restart timing measurable without real waiting. Real native PTYs exercise Start-to-introduction-to-incoming-reply against a synthetic transport. A bounded real Codex subscription probe uses three synthetic relationships and a fake sender; it cannot contact a customer. The live workspace and its active run are not opened or modified for these tests.

## Results

- Service suite: **92/92 pass, 13.235 seconds**, including 29 autonomy cases. Covers eligibility, imported stages, previous contact, interested/declined/low-intent/nurture/client states, fresh repeated-text events, message bursts, saved memory/links, timing, priority, permission/provider changes, pause/resume, restart, generation backoff and ambiguous transport.
- Native release build: **pass, 21.50 seconds**.
- Rust unit tests: **4/4 pass**; strict Clippy and formatting: **pass**.
- Native directory regression: **15 SGR clicks, 15.27 seconds**, including search, filters, preview tabs, 80×24 layout and no permission changes or sends.
- Real Codex, fake transport: **3/3 scenarios sent valid structured responses**. New introduction: **9.308 seconds**, resulting stage contacted. Interested demo request: **7.984 seconds**, approved link included, resulting stage meeting_requested. Decline: **7.476 seconds**, polite closure, resulting stage not_interested. These timings exclude the configured natural pause, which was zero in the probe. Three synthetic sends; zero customer sends.

- Installed real-service command: **pass**, provider picker, four pages, signed-in Codex status, compact resize, graceful shutdown and backup. All three aliases report **0.3.0**.
- Installed autonomous workflow: **34 SGR mouse clicks, 37.18 seconds**, automatic introduction and two separate replies with repeated inbound text, no review drafts, response-timing settings and three terminal sizes.
- Native autonomous workflow: **34 SGR mouse clicks, 36.89 seconds**. Start automatically sends one introduction for a genuinely new contact, then two incoming messages with identical text receive distinct automatic responses. No approval drafts are created. A separately booked relationship is preserved. Includes settings, response timing, memory, meetings, operator chat and 160×44 / 80×24 / 40×10 layouts.
- Phone pairing regression: **7 SGR mouse clicks, 7.56 seconds**, QR/phone fallback and 80×24 support.

- Compatibility terminal regression: **pass**, including import, explicit activation, memory, meetings, operator chat, export, one explicit synthetic send and paused restart.
- Migration/recovery cases preserve contacts, messages, memories and auth while adding the action timing fields. Temporary socket loss reconnects automatically without another Start; logout and account replacement pause. Fresh scoped reconnect-backlog events and the first activation-second message are handled at WhatsApp timestamp precision.

## Failures and corrections

- A test setup attempted to activate an already opted-out contact. The permission guard rejected it; the fixture now represents an inactive opted-out record.
- One legacy meeting-outcome test expected a review draft under the old default. The new automatic default correctly creates a ready operation; the expectation now reflects the requested behavior.
- Initial Rust checking caught an owned String passed where a borrowed hint was required; the borrow was corrected before the release build.
- The first native scenario expected an introduction after it had already booked a meeting for that contact. The planner correctly preserved the meeting_booked stage and did not pitch. The revised scenario uses a separate enabled new contact while retaining the booked relationship.
- A later native selector matched Refresh WhatsApp instead of the WhatsApp navigation entry. The scenario now navigates explicitly by page key. This was a test targeting failure; no UI interaction from that failed run is counted as passed.
- A fixture callback expression required parentheses around an async arrow fallback; syntax checking caught and corrected it before the final clean suite.

## Limits and conclusions

The default 5–15 second interval applies before composing and between automatic sends; model generation time is additional. Zero timing removes that deliberate pause. The internal operation ledger supports delivery safety and restart recovery, without exposing a manual approval workflow. Ambiguous transport outcomes stop automatic action for that contact until checked; generation failures retry automatically with bounded backoff.

Every accepted incoming message is stored separately using its WhatsApp message ID. A response can cover multiple messages received during the natural pause, with the latest event and recent pending-event bundle included in the prompt. Context is scoped per contact and bounded to recent messages and memory. Up to ten stable operator facts are retrieved separately from the five latest automatic summaries so that summary churn cannot hide older operator corrections. The model is instructed to maintain a concise cumulative relationship brief. A 60-summary regression verifies that an older operator preference still reaches the response context. Saved stages/messages, not a full historical WhatsApp archive, establish prior contact. The three live-model cases establish basic prompt/integration behavior, not exhaustive sales judgment or actual WhatsApp delivery. No fresh pairing, customer outreach, real calendar booking or live self-hosted inference was tested. Conversation handling currently uses text; voice transcription and image understanding remain deferred.
