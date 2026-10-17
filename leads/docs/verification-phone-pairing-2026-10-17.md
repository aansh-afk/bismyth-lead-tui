# Phone-number pairing verification — 2026-10-17

## Design and reference

Adds WhatsApp's phone-number pairing alternative to the native terminal. The public Baileys guide documents `requestPairingCode(phoneNumber)` after a connecting/QR event, with an E.164 number without `+`: https://github.com/WhiskeySockets/baileys.wiki-site/blob/main/docs/socket/connecting.md . The installed Baileys 7.0.0-rc14 implementation was inspected to confirm the API and credential behavior. The UI accepts international formatting and normalizes it before calling Baileys.

## Method and measured results

- Service suite: **46/46 pass in 9.023 seconds**. Includes the prior 36 outreach checks and 10 pairing cases: normalization, readiness, QR events, verified sender binding, code clearing, concurrent request rejection, disconnect cancellation, late responses, readiness/request timeout, linked-account protection, QR fallback and authenticated HTTP routing.
- `cargo clippy -- -D warnings`: pass.
- Native pairing PTY: **7 SGR mouse clicks, 7.81 seconds**. QR-dialog phone fallback, phone toolbar visibility/F shortcut, code and instructions at 128×40 and 80×24, keyboard submission, return to QR, disconnect, and SQLite assertions that no contacts/messages were created.
- Full outreach PTY regression: **33 SGR mouse clicks, 31.45 seconds**, with import, scope, memory, meeting, chat, exact-send cancellation/approval, one synthetic send, settings and three sizes.
- Both PTY scenarios use real HTTP/SQLite and compiled native UI; only the transport/model are synthetic. Phone numbers and pairing codes used by these tests are fixtures and never sent to WhatsApp.

- Installed `bismyth-leads` phone pairing scenario: **7 SGR clicks, 7.96 seconds**, using the packaged native executable and real HTTP service with synthetic pairing. Includes the final Get code label.
- Installed real-service startup scenario: pass (provider picker, four pages, live Codex login status, 80×24 resizing, clean shutdown and backup).
- Packed frontend and service files match the installed copies byte-for-byte. Package inspection excludes build targets, dependency trees, SQLite databases and private session keys.
- Data check: 6,938 stable pre-existing files matched the initial baseline. The live Oracle workspace was running when sampled; later its SQLite file changed and WAL/SHM/lock/session files disappeared, consistent with a normal shutdown/checkpoint. This prevents claiming byte-identical SQLite preservation against that live baseline. Read-only SQLite quick-check returned `ok`. Tests always used temporary workspaces; installation changes application files and performs no workspace migration. A second baseline was saved after the live workspace closed for final installation verification.

## Operational behavior

Page 2 offers Enter phone number, shortcut F, and the QR dialog offers Enter phone number instead. The TUI displays an eight-character code and phone-side instructions. The entered number never becomes the active sender until a confirmed connected socket supplies its identity. Codes are private authenticated transport state, not CRM activity or relationship backup content. Baileys' private auth state may hold its pending code until linking finishes; it stays in the existing auth store and is excluded from relationship backups. Existing linked credentials require explicit unlinking before account replacement.

Automatic retry is not used to request additional codes. Failure closes the unsuccessful socket and offers an explicit retry or QR. Switching back to QR cancels phone-code state and resets unregistered pairing credentials, while registered credentials are retained.

## Limits and conclusions

This verifies implementation, error handling, HTTP access control and terminal interaction. It does not establish live WhatsApp pairing, account acceptance, paired restart or message delivery. No live pairing code was requested for a user or arbitrary phone number, and no customer was contacted. Final linking must be completed by the user in WhatsApp; WhatsApp/network restrictions can still reject a code. No schema or relationship-data migration is required.
