# Oracle Leads status

Release: **v0.2.2**. Command: **bismyth-leads**. Product name: Oracle Leads.

The four-page terminal outreach app is the default installed command. The older browser/property-enquiry source remains in the repository and previous Git history. Its saved data is left in place; page 3 → L imports existing contacts into the new workspace without changing the originals.

Native interface: Ratatui + Crossterm, the terminal libraries used by Codex CLI. Mouse navigation, contact selection, scrolling, clickable actions/dialogs, field focus and cursor placement, bracketed paste, inline dashboard chat, responsive layout and keyboard controls. This dedicated outreach frontend uses the existing Codex CLI model integration; it is not the full Codex UI fork.

Phone pairing fallback: page 2 → Enter phone number (F), or the same option inside the QR dialog. Request an eight-character code and enter it in WhatsApp’s Link with phone number instead screen. Confirmed account identity remains authoritative.

Implemented: dashboard analytics and operator chat; startup Codex/self-hosted choice; SQLite relationship and run memory; scoped local Baileys pairing/inbox; reviewed opening messages; optional automatic incoming replies; contact import/export; local meetings/outcomes; prompts, links, quiet hours and send limits; backup/restore and source-linked editable memories.

New contacts start inactive. Each run starts paused. Exact opening-message review, paired-sender binding, opt-outs, stale-draft cancellation and uncertain-send handling are enforced by the service.

Verified in development: 46 passing service tests; complete terminal and installed-command checks; live Codex inference using an empty synthetic workspace; live unpaired Baileys QR readiness. No real WhatsApp account was linked and no customer message was sent. See [phone pairing verification](leads/docs/verification-phone-pairing-2026-10-17.md), [native verification](leads/docs/verification-native-2026-10-17.md) and [service verification](leads/docs/verification-2026-10-17.md).

Still requires user validation: real QR/phone-code pairing, paired restart, a selected test-recipient send/reply, delivery receipts and self-hosted endpoint readiness. Meetings are local records; external calendar sync and voice are deferred.
