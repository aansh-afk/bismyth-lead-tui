# Oracle Leads v0.6.0 — source contacts and companies

Date: 2026-10-17. Repository: bismyth-lead-tui. Command remains `bismyth-leads`.

## Method

Run the complete Node 24 service suite using isolated temporary SQLite workspaces and synthetic Firecrawl responses. Build the locked Rust TUI, run unit tests, formatting and strict clippy. Drive the real native terminal and real HTTP service with SGR mouse events and a synthetic Firecrawl transport, then inspect saved SQLite rows and JSON export contents. Run the existing outreach terminal regression with its synthetic model/transport. Never use the user's CRM, WhatsApp session or Firecrawl credits.

## Observed results

- Service suite: **132/132 passed in 12.195 seconds**. Includes 29 source tests covering structured names, roles, companies, email-only records, literal evidence, invalid/fabricated fields, directory affiliation mismatches, provenance deduplication, shared phones, batch bounds, polling after restart, pagination, cancellation, legacy upgrades, source deletion and preserved CRM memory/permissions.
- Rust unit tests: **4/4 passed**. `cargo fmt --check` and strict clippy pass. Final native release build: **23.48 seconds**.
- Native Sources workflow: **42 real mouse clicks, 31.49 seconds**. Named contact/role/company inspection, individual and bulk inactive imports, bounded collection, company browsing, JSON export including email-only records, free local reprocess action, whole-site progress, cancelled/confirmed individual deletion, all-source deletion, and 160×44 / 80×24 layouts. Zero outgoing messages.
- Existing native outreach regression: **34 mouse clicks, 36.99 seconds**. Existing contact permissions, memory, meetings, chat, autonomous introductions/replies, distinct inbound events, settings and wide/compact/tiny resize behavior pass with a synthetic model and WhatsApp transport. Three synthetic sends, no live messages.

## Failures found and corrected

1. An older assertion counted every candidate as a phone. Email-only records now remain in the catalog; the assertion checks phone records explicitly.
2. The first legacy-upgrade filter tried to JSON-parse already decoded candidates returned by the page-detail helper. The service suite caught this; filter the decoded array directly. Legacy collection and optional refresh tests now pass.
3. Terminal test locators initially matched background text or the form title instead of the contact row/collect button. Scope locators to the selected row and padded button label. These were test navigation failures, not evidence of a failed scrape.

## Behavior and limits

Structured extraction requests use the official Firecrawl v2 JSON format alongside markdown/links, and batch scraping uses the documented batch endpoint. Supporting names and phone/email identifiers must appear in a literal page passage. For generic JSON extraction, role and company must also occur in that supporting passage; missing or unsupported fields remain empty. Deterministic AREA and REAAK adapters additionally use explicit member-profile headings, listing-card boundaries and name/firm lines. They retain separate affiliation evidence and never borrow the publishing association’s phone for each member. Format/evidence validation does not independently verify a person's identity, ownership, decision-making authority, WhatsApp registration or continued employment.

Research groups company affiliation using name plus an explicitly linked company website, or the source domain when no website is provided. Different company names or unrelated source domains remain separate. This is a sourced relationship catalog. The existing CRM remains one phone relationship with one company/role field; people sharing a phone import once, with associated people, affiliations, emails and source URLs in notes. Email-only contacts remain in research/export. Existing CRM rows are never overwritten by a source import; new rows start inactive without consent.

Collection defaults to 10 pages and is capped at 100 per request. Already scraped current-format pages require an explicit refresh; older unnamed records are eligible automatically. Repeat collection to process the remaining discovered results. The terminal lists at most 500 pages and 1,000 contact/company records; JSON export and bulk import cover all saved records. Per-page content is capped at 150,000 characters, up to 100 generic structured contacts plus fallback identifiers, or up to 1,000 explicit directory records, and the preview at 20,000 characters. A bounded crawl cannot guarantee every contact on an arbitrary website.

Deleting sources removes their stored page content and extracted research catalog entries. Imported CRM relationships and permanent memory survive. Active jobs must be cancelled first; late polling cannot restore deleted sources. Research run history and older backup snapshots retain historical records.

**Live Firecrawl JSON extraction, remote batch/crawl behavior, account authentication and actual credit usage remain unverified.** Tests use synthetic responses and establish application behavior only. No real outgoing messages were sent; the live WhatsApp service and quiet hours were left untouched.

References: [JSON mode](https://docs.firecrawl.dev/features/llm-extract), [Batch scrape](https://docs.firecrawl.dev/api-reference/endpoint/batch-scrape), [Crawl](https://docs.firecrawl.dev/api-reference/endpoint/crawl-post).

## Read-only audit of the user's saved scrape

The live database contains 101 pages and 242 pre-existing CRM contacts. The previous extractor saved 244 phone occurrences (115 unique); AREA's office number occurred on 98 pages. No research source had been imported into the CRM, and none of its phones overlapped existing CRM records. Thirty-two saved pages were individual member profiles; the broad crawl also collected listing pages and unrelated events.

Using a private read-only snapshot, the corrected parser produced **297 research records: 289 named records and eight site contacts**. Of the named records, 109 have phone identifiers and 180 do not. An isolated import created **107 phone relationships: 105 named and two shared**, with zero invalid rows and zero guessed unnamed relationships. Every imported row was inactive and without consent. Website-wide site contacts were skipped. The actual live CRM and research tables were not modified. A private audit and complete preview were saved under the user's workspace `audits` directory; no contact identifiers were added to this repository.

AREA member-directory crawl requests now filter to profile and pagination paths. Local reprocessing uses cached content only; unsupported website layouts remain unchanged. Markdown-escaped email underscores are decoded. Same-person/company/phone records merge evidence and missing/present emails across pages, while different people sharing a phone remain distinct research records.
