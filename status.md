# Oracle Leads status

Release: **v0.4.1**. Command: **bismyth-leads**. Product name: Oracle Leads.

Local Laya: pinned ONNX English checkpoint, CPU worker, structured intent assessment on each new event, automatic writer fallback and Decision engine settings. The integration is advisory: the writer verifies context and remains responsible for the final response/stage. Real local evaluation: 16/26 correct, warm median 1.915 s, 1,680 MiB RSS. Real Codex corrected a confidently wrong Laya timing classification. Explicit setup: `bismyth-leads --setup-laya`. See [Laya/relogin verification](leads/docs/verification-laya-relogin-2026-10-17.md).

WhatsApp recovery: expired authentication prompts relogin on any page. Phone pairing targets the previous verified number; QR linking checks the same identity. Recovery preserves contact permissions and memory. Wrong-account recovery is rejected until explicit Unlink. Temporary outages reconnect automatically; after auth recovery, press Start Agent. Quiet hours remain unchanged.

The compiled build version appears beneath the logo, or in the status footer at compact sizes.

The four-page terminal outreach app is the default installed command. The older browser/property-enquiry source remains in the repository and previous Git history. Its saved data is left in place; page 3 → L imports existing contacts into the new workspace without changing the originals.

Search spacing: Contacts and WhatsApp now reserve a blank row above and below the live search field, separating connection/source status, search and source filters. See [spacing verification](leads/docs/verification-search-spacing-2026-10-17.md).

Native interface: Ratatui + Crossterm, the terminal libraries used by Codex CLI. Mouse navigation, contact selection, scrolling, clickable actions/dialogs, field focus and cursor placement, bracketed paste, inline dashboard chat, responsive layout and keyboard controls. This dedicated outreach frontend uses the existing Codex CLI model integration; it is not the full Codex UI fork.

Phone pairing fallback: page 2 → Enter phone number (F), or the same option inside the QR dialog. Request an eight-character code and enter it in WhatsApp’s Link with phone number instead screen. Confirmed account identity remains authoritative.

Contacts: combined saved leads and available WhatsApp phone metadata, one-time saved-lead load in the default workspace, instant search, source/access filters, live selected preview and overview/chat/memory tabs at compact sizes. WhatsApp contact-state refresh remains separate from message history and message permission. Saved linked sessions reconnect at service startup while outreach stays paused. The bismyth-leads, oracle-leads and oracle launchers share the released frontend; oracle configure-selfhost remains available.

Implemented: dashboard analytics and operator chat; startup Codex/self-hosted choice; SQLite relationship and run memory; scoped local Baileys pairing/inbox; autonomous introductions and context-aware incoming replies; stage-aware relationship handling; configurable natural response timing; contact import/export; local meetings/outcomes; prompts, links, quiet hours and send limits; backup/restore and source-linked editable memories.

New contacts start inactive. Each incoming WhatsApp message is handled as a distinct event; a saved replied stage does not block later messages. Activity replaces the review inbox. Default timing is 5–15 seconds before composing and between sends; Settings can set it to zero. Verified: 92 passing service tests, installed autonomous terminal workflow, and three real Codex scenarios using synthetic contacts and transport. See [autonomy verification](leads/docs/verification-autonomy-2026-10-17.md).

Each run starts paused. Start Agent autonomously assesses allowed relationships and sends without per-message review. Paired-sender binding, opt-outs, human takeover, stale-context cancellation and uncertain-send handling are enforced by the service.

Verified before v0.2.4: 57 passing service tests; complete terminal and installed-command checks; live Codex inference using an empty synthetic workspace; live unpaired Baileys QR readiness. During the contact-empty investigation, the already linked account reconnected and delivered 241 WhatsApp contacts, bringing the live directory to 242. No contact was activated and no customer message was sent. See [session recovery verification](leads/docs/verification-session-recovery-2026-10-17.md) for v0.2.4 checks. See [contacts verification](leads/docs/verification-directory-2026-10-17.md), [phone pairing verification](leads/docs/verification-phone-pairing-2026-10-17.md), [native verification](leads/docs/verification-native-2026-10-17.md) and [service verification](leads/docs/verification-2026-10-17.md).

Still requires user validation: fresh QR/phone-code pairing, a selected test-recipient send/reply, delivery receipts and self-hosted endpoint readiness. Meetings are local records; external calendar sync and voice are deferred.
