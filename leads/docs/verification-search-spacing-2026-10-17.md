# Search spacing verification — 2026-10-17

## Change and method

The contact toolbar placed connection/source status, the live search field and source filters on consecutive terminal rows. Contacts and WhatsApp now reserve a blank row above and below search, plus the existing gap before the list. The header grows from five to seven rows. Below 28 terminal rows, the contact pages reclaim two unused rows below the page title, retaining the original list and preview height. Input, mouse hit regions and Clear continue to use the rendered search rectangle.

Checks use the compiled native frontend, synthetic contacts, a loopback service and temporary SQLite workspaces. No live workspace is opened or altered for this UI adjustment. The Start agent explanation was checked against the service worker, dispatch/review code and current settings through a read-only SQLite query. No automation behavior changes are included.

## Results

- Final native release build: **pass, 23.60 seconds**.
- Formatting and Git whitespace checks: **pass**.
- Native directory scenario: **15 SGR mouse clicks, 15.18 seconds**. Live name/phone search, source filters, previews, compact memory/chat, selected-identity retention and 160×44 / 80×24 layout pass. The 41-contact fixture retained its original scope and recorded no outgoing messages.
- WhatsApp pairing scenario: **7 SGR mouse clicks, 7.41 seconds**. Toolbar actions, QR/phone fallback, keyboard submit, disconnect and 128×40 / 80×24 layouts pass. No contacts or messages were created.
- Saved terminal row captures were inspected to confirm a blank row above and below the search field, and the compact preview remains visible.

The service and automation code are unchanged by this layout fix. The previous 60-test service run is recorded in the session-recovery report; it was not rerun for this UI adjustment.

## Failures and limits

The first build attempt failed because a broad release-version replacement also altered the unrelated castaway dependency version in Cargo.lock. That dependency was restored to its original pinned 0.2.4; only the application package version changes to 0.2.5. No dependency upgrade is part of this release.

The first native directory check then caught a compact preview regression: the extra header rows hid a saved memory at 80×24. Compact contact pages now reclaim the title gap instead of shrinking the contact preview. The failed run is not counted as a pass.

Terminal row captures establish layout and interaction behavior in an emulated screen. A new release takes effect when the user reopens the command; the user's running UI and outreach state are not restarted or modified by these checks.
