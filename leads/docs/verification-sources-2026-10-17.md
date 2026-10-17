# Firecrawl Sources verification — 2026-10-17

## Scope and method

Added native page 5 without moving pages 1–4. It supports Firecrawl v2 web search, single-page scraping, whole-domain crawling with a 1–100 page limit, persistent progress, pagination and cancellation, public phone/email extraction, and source-linked inactive contact imports. Configuration uses a masked field and a mode-0600 key file outside the database/exports; an environment key is also supported.

Service tests run on Node 24.13.0 against isolated SQLite databases and injected Firecrawl HTTP responses. Native checks use the real compiled frontend and service, fake public source pages and a synthetic API key. No live Firecrawl key, paid API request or customer WhatsApp account is used in these checks.

Official contracts were read from Firecrawl's Search, Scrape, Crawl, Crawl status, Cancel Crawl and Credit Usage reference pages. The integration sends requests only to https://api.firecrawl.dev/v2, rejects provider redirects and validates pagination URLs before attaching authorization. It does not fetch target websites directly on the user's machine.

## Measured results

- Final service suite: **118/118 passed in 11.986 seconds**. Fifteen Sources tests cover URL validation, evidence extraction/deduplication, private key storage, credential exclusion, authenticated HTTP access, search/scrape provenance, inactive import, duplicate permission preservation, bounded domain crawling, saved-job recovery, safe pagination, canonical www redirects, cancellation races, invalid limits, missing credentials and provider errors.
- Existing v2 workspace migration test passes with schema v4 and retained contact, conversation, memory and authentication data. Research pages/runs are included in backups; restored remote crawls become interrupted and their external job IDs are cleared.
- Native Sources smoke: **18 real mouse clicks, 15.13 seconds**. Fifth-page navigation, masked key input (plaintext absent from terminal), credits, search, selected-page scraping, source/contact evidence, inactive contact import, whole-site progress and wide 160×44 / compact 80×24 layouts. No outgoing messages.
- Existing outreach native smoke: **34 mouse clicks, 37.08 seconds**. Existing contact import/scope, memory, meetings, automatic introductions and distinct inbound events, settings and resize behavior passed with the fifth navigation item.
- Rust unit tests: **4/4**. Formatting and strict clippy checks pass after the lint correction below. The v0.5.0 release build completed in 24.83 seconds.

## Failures found and corrected

1. A WhatsApp wa.me URL with an international number outside the selected country was missed. Recognize wa.me numbers as international and retain source evidence. The extraction test now passes.
2. The existing schema-migration assertion expected v3. Updated it to v4; a temporary test-only attempt to remove tables before the fixture's shutdown backup was reverted. Production migration remains additive.
3. Native smoke locators initially clicked matching background text outside a modal. Focused locators now select the intended menu row and import button. The real mouse workflow passes.
4. Strict clippy identified identical branches in scroll handling. Combined the conditions without suppressing the lint.

## Limits and conclusions

Live Firecrawl authentication, account credit consumption, rate limits and remote crawling remain **unverified until a user supplies a key**. Configure it in Sources, then use Credits and a small real request. Mocked provider responses establish application behavior, not live provider availability.

A crawl page limit is not an exact credit quote. The UI shows the last manually checked balance and provider-reported run credits when present; it does not invent missing usage. Remote crawls may continue after closing Oracle; the next session polls the saved job ID rather than submitting it again. A lost start response is marked uncertain and never automatically retried.

Phone extraction validates format and preserves evidence, not identity, decision-making authority, permission or WhatsApp registration. Ambiguous local numbers are skipped. Non-Indian/non-North-American local phone formats require explicit international numbers. Page content is capped at 150,000 characters per source and the preview at 20,000; a later section of a long page can contain missed contact details. Sources remain untrusted website data. No discovery/import action starts outreach, and duplicates do not change existing CRM scope or stage.

The fifth page is native-TUI functionality; hidden legacy curses mode retains four pages. No live WhatsApp service was restarted and quiet hours were not changed during development.
