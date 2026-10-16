# Saved-run recipient selection verification

Date: 2026-10-16. Package: 0.1.22. Runtime: Node 20.19.5, npm 10.8.2.

## Behavior and scope

The previous Contacts checkboxes lived only in memory, were not isolated when runs changed and were bypassed by Enter's focused-contact review. The user requested choosing which people receive WhatsApp messaging from saved runs before reviewing the remaining product issues.

Saved runs → W now loads that run's Contacts screen. Space toggles the highlighted approved Indian mobile contact; B selects approved phones; Z clears choices. Enter and W review only checked recipients. The existing dialog defaults to Preview only; Send remains a separate explicit choice. Run identity, checked count and selection controls are visible. Enter on Saved runs retains queue loading.

Optional version-1 run metadata stores canonical contact IDs per run. Old runs, copied runs and new runs start unchecked. Recollection preserves existing choices and leaves new contacts unchecked. Approval remains an evidence decision rather than an implicit instruction to send. Revocation prunes selection. Selection and approval updates save a cloned run before replacing the current screen state, so write failures do not invent successful changes.

The preview/send service intersects requested recipients, the current run's canonical approved contacts and its selection. Empty or malformed choices produce zero router requests. Canonical run provenance overrides caller-supplied metadata. The service rechecks eligibility after availability and immediately before dispatch, including after durable pending-operation persistence and the final progress callback. A recipient removed at that final boundary retains a definitively unsent failed operation. Existing sender/number deduplication, uncertain operations and opt-outs still block repeated introductions. Receipt and opt-out ingestion for previous operations remains independent of the new outgoing selection.

## Method

Local temporary-store/controller regressions exercise persistence, restarts, same-number run isolation, copies, duplicate phone/WhatsApp sources, new captures, ineligible contacts, select-all/clear, unchecked focus, stale dialogs, disk failures and active-task blocking. Service regressions exercise missing/malformed selection, caller-supplied extra contacts, canonical evidence, approval revocation and asynchronous deselection boundaries.

The real loopback HTTP router fixture receives both an approved checked contact and an approved unchecked contact as caller inputs. Its endpoint assertions reject checks, previews or sends to the unchecked number. The selected contact's pending operation is verified on disk before transport; receipt/reply synchronization and subsequent deduplication are retained.

The real-launcher pseudo-terminal script uses synthetic saved runs and a temporary stub for `codex login status`. It does not invoke a model, browser, portal, Firecrawl or external router. It exercises saved-run W, empty Enter, Space, focusing an unchecked person during review, the preview default, independent run choices, restart persistence, B/Z, compact controls, preserved enquiry outcomes and clean session-lock release.

## Results and corrections

The focused six-file regression run passed **65/65**, with no failures/cancellations/skips, in **3.871 seconds**. The first full configured run passed 389/391 in 176.037 seconds. One older authenticated-contact fixture lacked the newly required selection; it now explicitly proves approval alone makes no request before selecting the recipient. One new test's fixed count of event-loop yields expired before filesystem completion under concurrent load; its wait now uses a five-second deadline and short asynchronous polling. The affected provenance/workflow files then passed **29/29** in **1.948 seconds**.

An initial build exposed TypeScript control-flow narrowing in a test assertion; reading the mutable controller property afresh resolved it. Initial pseudo-terminal attempts exposed a startup-read assumption and an obsolete screen-title expectation in the new harness. Waiting for the actual Atlas lead desk title corrected the harness. The complete source-launcher terminal scenario passed afterward.

The final full configured `npm test` run passed **391/391**, with zero failures, cancellations or skips, in **163.398 seconds**. No production changes followed that run. Both source checkouts built successfully. Installer shell syntax and git whitespace checks passed. The packaged archive contains **39 files**, **126962 bytes**, with SHA-256 `af3ae20ce768deb8f1124ee9b1ee6f985256a3b1287784bc313ba0c59e037b91`. Compiled package files match both checkouts. Tests, source maps, credentials and browser profiles are excluded. The actual saved Firecrawl credential and user-provided example contact occur zero times in archive contents.

## Remaining product issues

1. This repository supplies a contract-v1 WhatsApp client and server handoff, not the deployed Baileys server or paired sender session. Live messaging still needs that compatible service.
2. Autonomous AI conversations are absent. The TUI sends a reviewed fixed Atlas introduction and refreshes replies/referrals; it does not take over new conversations or integrate the CRM.
3. Company/directory discovery is absent. Discovery still targets portal property listings, and Firecrawl scrapes existing listing URLs rather than searching business sources.
4. Direct salesperson identity and WhatsApp availability are not guaranteed. NoBroker may expose portal relay numbers; masked, premium-only or otherwise unavailable numbers remain unavailable.
5. Seven-portal fixture coverage does not verify every authenticated live flow. Website changes, login/security checks, location selection and plan limits can still require intervention.

An additional code-review observation for the future AI worker: reply ingestion validates campaign timestamp, sender/chat identity and `fromMe`, but does not explicitly reject `isHistorical=true`. The existing historical fixture also predates the campaign. Historical replay handling needs a focused decision and regression before autonomous replies are enabled; no autonomous worker is present in this release.

## Limits

All send/availability/receipt assertions use local fixtures. No real WhatsApp message, property booking, enquiry, OTP or security interaction was performed for this change. These tests establish selection exclusion and persistence, not a deployed router, actual delivery or qualified Atlas leads. Existing running TUI sessions need a normal quit/reopen to load updated code.
