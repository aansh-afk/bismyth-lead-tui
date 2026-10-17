# Oracle Leads status

Release: **v0.2.0**. Command: **bismyth-leads**. Product name: Oracle Leads.

The four-page terminal outreach app is the default installed command. The older browser/property-enquiry source remains in the repository and previous Git history. Its saved data is left in place; page 3 → L imports existing contacts into the new workspace without changing the originals.

Implemented: dashboard analytics and operator chat; startup Codex/self-hosted choice; SQLite relationship and run memory; scoped local Baileys pairing/inbox; reviewed opening messages; optional automatic incoming replies; contact import/export; local meetings/outcomes; prompts, links, quiet hours and send limits; backup/restore and source-linked editable memories.

New contacts start inactive. Each run starts paused. Exact opening-message review, paired-sender binding, opt-outs, stale-draft cancellation and uncertain-send handling are enforced by the service.

Verified in development: 36 passing service tests; complete terminal and installed-command checks; live Codex inference using an empty synthetic workspace; live unpaired Baileys QR readiness. No real WhatsApp account was linked and no customer message was sent. See [verification](leads/docs/verification-2026-10-17.md).

Still requires user validation: real QR pairing, paired restart, a selected test-recipient send/reply, delivery receipts and self-hosted endpoint readiness. Meetings are local records; external calendar sync and voice are deferred.
