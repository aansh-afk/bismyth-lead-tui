# Sources: Firecrawl prospect research

Add page 5, Sources, after Settings. Keep 1–4 stable. Search by query/location/country; inspect one URL; crawl an entire domain with an explicit 1–100 page limit (default 10). Save queries, URLs, fetched content, contact evidence and crawl progress locally. Crawl stays on the chosen domain, with no external/subdomain expansion. Poll existing job IDs after restart; never restart paid jobs automatically. Allow cancelling a crawl.

The page uses a row list and selected-source preview, with key setup, search, scrape, crawl, history and import actions. Phone candidates retain evidence and a source URL. Select individual candidates to import into the existing CRM as inactive, unconsented contacts. Duplicate phone records retain their existing stage/scope. Source discovery does not authorize outreach. Email addresses remain in source research records.

Use Firecrawl's official v2 search/scrape/crawl/status/cancel and credit-usage endpoints through the local service. Store the API key in a mode-0600 file outside the database, entered through a masked TUI form (or FIRECRAWL_API_KEY). Never export or display the key. No key is needed to implement and test; live billable operations require user configuration in the app.

Persist source pages and research runs in SQLite and include them in credential-free backups. Limit request/response sizes, sanitize provider errors, validate URL schemes and public targets, and bound page/content/results counts. Show reported credits separately from account balance; do not estimate costs from assumptions. Use official API shapes and injected fake HTTP in tests; report that live Firecrawl is unverified when no key is available.

Validation: service API/auth/config, source provenance, extraction, duplicate/inactive import, crawl progress/restart/cancel and key exclusion; native mouse/keyboard navigation across all five pages and wide/compact layouts; regression tests and release artifact integrity.
