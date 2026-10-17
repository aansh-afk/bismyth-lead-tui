# Oracle Leads verification — 2026-10-17

## Scope and method

Verified the native four-page curses interface, the actual loopback HTTP service, SQLite persistence, provider adapters and local Baileys QR initialization. Deterministic tests use temporary databases and explicitly synthetic phone numbers/transport. No actual customer was contacted. The installed `oracle` and `oracle-leads` launchers point to the outreach-only application.

Environment: Python 3.12.3, Node 24.13.0, Baileys 7.0.0-rc14, installed Codex CLI. The first Astryx command encountered the system Node 20 mismatch; the final product uses the user-selected terminal interface and has no browser/Astryx dependency.

## Measured results

- **36/36 service tests passed**, no skips/cancellations, final recorded duration **5.094 seconds**. Coverage includes inactive imports, permission and sender checks, unscoped/history rejection, opt-outs, concurrent workers, in-flight deactivation/provider changes, stale drafts, daily caps/quiet hours, uncertain sends, source-backed memories, CSV round trips, backup/restore, contact deletion, meeting outcomes, generated openers and authenticated HTTP access.
- **13/13 retained engine/bridge regression checks passed**, duration **6.857 seconds**. These protect the preserved self-hosted compatibility engine, not the new product's sales quality. Its real installed Codex tool-round-trip check uses a deterministic HTTP fixture.
- **Full terminal scenario passed** against the real local HTTP/SQLite service and an explicitly synthetic WhatsApp transport. Exercised contact file import, permission/activation, permanent notes, meeting create/delete, operator chat, settings, CSV export, exact-message review, one synthetic send, restart persistence and paused startup. Captured terminal screens are in `terminal-smoke-screens.txt`; all contacts and messages in that artifact are synthetic.
- **Installed-command terminal check passed** with a fresh workspace. Exercised the provider picker, all four pages, the real ChatGPT login-status check, resize to 80×24, clean shutdown, automatic backup and lock cleanup.
- **Live Codex subscription inference passed** with an empty synthetic workspace. Answer: “There are 0 contacts and 0 booked meetings recorded.” No WhatsApp send or customer data was involved. Login status was independently confirmed through the production adapter.
- **Unpaired live Baileys initialization passed**: reached `qr_ready` and generated a **65-module QR**. The QR itself was not logged or published. The temporary unpaired workspace was removed after disconnect. No account was linked.
- Python compile checks and Git whitespace checks passed. The installed `oracle --version` reports `Oracle Leads 0.2.0`; coding-oriented `oracle exec` is rejected.

## Failures found and corrected

- An ambiguous transport error initially changed an uncertain operation to failed. The handler now preserves uncertainty and prohibits ordinary draft reapproval/retry.
- Codex reports login status on stderr. The readiness adapter now inspects both output streams without exposing their contents.
- Terminal smoke input initially used a non-application arrow escape sequence. The selection harness was corrected and the complete real terminal flow reran successfully.
- A stale-draft assertion expected the previous error wording after newer messages began cancelling drafts immediately. Updated the assertion to verify rejection of the now-unreviewable draft; the stronger dispatch safeguard remains tested.

## Limitations and unverified behaviour

- A real account has **not** been QR-paired. Actual sender identity, persistence across a real paired restart, inbound customer replies, WhatsApp delivery/read receipts, opt-outs on the live service and phone-side manual takeover still require a user-selected account and test recipient. The ready QR and fixture sends do not prove those outcomes.
- The self-hosted provider adapter reuses the existing Oracle configuration; its live endpoint/model quality is **not verified**. No paid GPU was started or changed.
- Curses QR scanning depends on terminal size, font and phone camera. The UI reports the actual required dimensions (approximately 80×46 for the observed QR). Real scanning was not tested.
- Node's built-in SQLite module currently emits an experimental-feature warning on this installed Node release. The TUI captures service diagnostics so this warning does not corrupt its display.
- Active runtime is sampled by heartbeat. Forced termination can lose the final few seconds of runtime measurement; queued data remains transactionally persisted.
- Meeting records are local; external calendar invitations/synchronization are not implemented. Voice and autonomous discovery are deferred.
- Automatic snapshots are local and exclude WhatsApp credentials. They are not protection against losing the machine unless copied elsewhere. Restore is limited to 128 MB and 100,000 rows per table; all restored contacts are inactive.
- The operator chat retrieves bounded relevant context, not the entire database. AI classifications and summaries remain reviewable and are not proof of sales outcomes.

## Conclusion and next step

The implemented app is installed and verified for local operation with synthetic end-to-end transport, real Codex subscription inference and real unpaired QR readiness. Start `bismyth-leads`, pair your own account on page 2, import contacts on page 3, and explicitly activate a selected, permitted test contact. Start with reply review mode. Actual WhatsApp delivery remains unverified until that live test.
