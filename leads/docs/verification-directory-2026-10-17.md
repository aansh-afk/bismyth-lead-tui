# Contact directory verification — 2026-10-17

## Scope and method

The user requested both saved Bismyth/Oracle leads and available linked WhatsApp contacts in a friendly list, with search and an active contact view. The native frontend now provides live search, counts, source/access filters, compact master-detail layout and overview/chat/memory tabs. Existing saved leads load once in the default workspace; isolated workspaces require explicit import. Directory listing does not grant outreach consent.

Production Baileys contact-event handling is tested using an injected socket; native tests drive the actual compiled Rust interface through PTYs, a real loopback API and SQLite. Fixture phone numbers and names never go to WhatsApp. The installed Baileys app-state collection export was checked (five collections). Relevant primary references: [contact events](https://github.com/WhiskeySockets/baileys.wiki-site/blob/main/docs/socket/receiving-updates.md), [app-state synchronization](https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/chats.ts).

## Measured results

- Service regression suite: **57/57 pass, 7.551 seconds (final run)**. Includes one-time saved import, failed-scan retry, inactive metadata import, source overlap, operator-name/opt-out preservation, later placeholder names, deletion suppression, directory visibility beyond 10,000 records, stale socket events, app-state readiness/refresh and existing outreach/pairing safeguards.
- Rust unit tests: **4/4 pass** (matching names/cross-field terms/formatted numbers, short numeric name disambiguation, Unicode caret placement and editor movement).
- Rust `cargo clippy -- -D warnings`: pass.
- Initial native directory scenario: **14 SGR clicks in 13.86 seconds**, 41 synthetic contacts, live name/formatted-phone search, source and enabled filters, results/clear/no-match states, preview/chat/memory tabs, Home/End and 160×44 / 80×24 layout. SQLite verifies no extra permissions and no outbound messages.

- Final native directory scenario: **15 SGR clicks, 15.31 seconds**. Also exercises Refresh WhatsApp and verifies selection stays on the same contact after an API rename changes their alphabetical position.
- Existing complete native outreach regression: **33 SGR clicks, 31.16 seconds**, including import, scope, notes, meetings, operator chat, reviewed/cancelled sends, one synthetic send and three terminal sizes.
- Live local saved-data preparation: one valid legacy phone contact was loaded into the user's default directory with zero active/consented contacts. A private SQLite recovery copy was made first. Existing contact records and WhatsApp auth were preserved; 6,937 original Bismyth files matched their SHA-256/size/permission baseline. No WhatsApp account was connected by this preparation because no registered session was present.

- Installed directory scenario: **15 SGR clicks, 15.63 seconds**, using the actual `bismyth-leads` executable. Includes refresh, live search, tabs, compact preview and selected-identity retention after a rename.
- Installed phone-pairing regression: **7 SGR clicks, 7.64 seconds**, preserving QR/phone fallback and 80×24 operation.
- Installed real-service command scenario: pass, including startup provider choice, four pages, existing Codex login status, compact resize, graceful shutdown and automatic backup. Its empty-state assertion now checks the result count because narrow panels wrap explanatory prose.
- A late LID-to-phone mapping now retries cached contact metadata, so a valid delayed mapping can populate the directory without guessing any phone identity. The new service case verifies malformed mappings remain ignored.

Packaging excludes local databases, session keys, dependencies and Rust build targets; the release includes the native executable, source and verification artifacts.

## Findings and corrections

The compact interface previously hid the contact preview. Its persistent layout now leaves room for context and tabs. Search previously required submitting a dialog; it now updates directly from typing and paste. Search consumes shortcut characters, so typing page numbers, Q or spaces does not navigate, quit or start the worker. Selected identity is retained across refresh, and a failed detail lookup cannot leave another person's actionable preview in place.

A previous smoke-test selector matched background Saved text instead of the Save/Actions buttons; it now selects the actual form action. These failed selector runs were not counted as passed UI interactions.

Baileys' skipped-history path can skip initial app-state sync. Contact-state refresh now runs separately when app-state keys become available and through the visible Refresh WhatsApp action. Message-history processing stays disabled. Exact phone identities or legitimate LID mappings are required; unresolved LIDs are never guessed.

## Limits and conclusions

The UI/service behavior is verified with synthetic contacts and transport. Live address-book completeness and actual metadata delivery require the user's paired account; WhatsApp may not share its entire phone address book, usable phone identities, or previously synced contact mutations. Incremental refresh preserves auth state rather than clearing protocol versions. CSV/JSON import remains available for missing contacts. No customer message was sent during development. This work does not establish live message delivery or externally booked meetings.
