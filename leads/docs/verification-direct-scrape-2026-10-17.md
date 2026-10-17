# Oracle Leads v0.7.0 — scrape directly into source-linked contacts

Date: 2026-10-17. Native command remains `bismyth-leads`.

## Method

Run Node 24 tests with temporary SQLite databases and synthetic Firecrawl responses. Build the locked native TUI and run Rust tests, formatting and strict clippy. Exercise the actual native TUI and HTTP service with synthetic provider/WhatsApp transports and real SGR mouse input, then inspect persisted contacts and source links. No paid research, live contact imports or outgoing customer messages are used for verification.

## Results

- **139/139 service tests pass in 12.565 seconds**; 36 cover Sources. New cases verify immediate inactive imports, selection IDs/counts, duplicate attribution without changing existing CRM fields or permissions, research-only API compatibility, local import failure recovery without another paid scrape, association-contact exclusion, phone-less records, provenance backup/restore and additive schema-v4 migration.
- Dedicated v4 migration recheck: **1/1 passes in 0.415 seconds** after changing the test to close its second database connection before fixture cleanup. Existing CRM rows and permanent facts survive; the new source table starts empty.
- **39-click Sources terminal flow passes in 30.42 seconds**. It scrapes an explicit URL while another source is selected, observes immediate CRM creation with inactive/no-consent flags, sees the newly selected source and its saved-contact count, opens the saved relationship and its SCRAPED FROM URL, then exercises collection, company browsing, exports, local reprocessing, bulk import, crawl progress and individual/all-source deletion at 160×44 and 80×24. Source links survive deleted research pages. Zero messages.
- Existing outreach terminal regression: **34 mouse clicks in 36.96 seconds**, including scope cancellation/activation, memory, meetings, chat, autonomous introductions/replies, repeated inbound text and 160×44 / 80×24 / 40×10 layouts. Three synthetic sends; no real messages.
- **4/4 Rust unit tests pass**. Formatting and strict clippy pass. Final release build: **24.30 seconds**.

## Findings and corrections

Strict clippy initially rejected adjacent one-line conditionals and a collapsible nested conditional in the new source-navigation code. Separated the independent conditionals and used a let-chain for source selection, without lint suppressions. The old migration assertion was updated to schema v5. No functional service test failed.

## Persistence and behavior

The TUI explicitly requests `import_contacts: true` for Scrape URL. An ordinary API scrape remains research-only. Crawl, batch collection, search and local directory reprocessing retain their prior behavior. New CRM contacts remain inactive without consent; automation scope and quiet hours are unchanged. Site/association contacts are excluded from automatic import; records without phone numbers remain in source research and export.

A new `contact_sources` table stores contact → URL/title/evidence associations independently of editable CRM fields and research pages. Duplicate numbers gain source attribution while retaining name/company/notes/stage/sender/permissions. Links are unique per contact and URL, survive research deletion and backup/restore, and cascade only when the relationship itself is deleted. Older backups without this table still restore. Re-scraping the same page refreshes its attribution without creating another relationship/link.

A scrape that completes remotely but encounters a local import error keeps the saved source, reports the separate import problem, and directs the operator to retry import rather than another billable scrape. Contact insertion and source linking are separate local transactions; a failed link transaction can leave the contact saved with its primary source, and a repeated import completes the links safely.

## Authorized live source clearing

At the user's explicit request, the existing application's authenticated loopback deletion endpoint cleared **92 saved source pages**. A read-only before/after check confirmed **zero sources remaining**, while **242 contacts, 101 messages, 10 memories and zero meetings** were preserved. No live service restart, contact import, settings change or message was performed. Research run history, private audit exports and existing backup snapshots retain historical records.

## Limits

Fresh Firecrawl JSON extraction and actual account/credit behavior remain unverified here; provider responses in tests are synthetic. Missing personal identifiers cannot be invented. The primary CRM still requires a phone and has one company field per relationship; shared affiliations and extracted evidence remain available in the source catalog and saved provenance.
