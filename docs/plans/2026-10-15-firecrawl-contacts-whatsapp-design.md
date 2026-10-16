# Firecrawl contact collection and WhatsApp client

Approved by the user: Firecrawl collects publicly visible advertiser contacts;
Playwright continues existing property-interest/contact-form runs; the TUI sends
selected introductions through the external self-hosted Baileys router.

## Implementation

- Add optional per-project contact capture with status/evidence/time, separate from
  enquiry status. Old runs remain readable. Copies preserve source contact records.
- Firecrawl v2 scrape requests Markdown/links only, one request per listing, bounded
  time/bytes/budget. No website cookies, private inbox or supplied contact profile
  is uploaded. Validate actual target status and origin; missing/masked contacts
  stay absent. No automatic retry on auth, credit or blocked-page errors.
- Extract candidate values deterministically, then use existing ChatGPT-only Codex
  structured output to choose attributable seller/agency/developer contacts. Model
  output cannot invent values or evidence. Unconfirmed candidates require review.
- Store the Firecrawl key in a separate private credential file or environment;
  never run configuration, exports or model-child environment. The key has been
  supplied for a small bounded live read check after fixture verification.
- Add Contacts as a fifth TUI section. H collects contacts; O exports contact data;
  Enter shows source evidence and an introduction preview. Existing enquiry controls
  remain. Collection uses pause/stop/cancellation without opening Chrome.
- Add a Baileys REST client for the existing v1 contract. Configure endpoint/key/
  selected sender session locally. Gathered numbers are not WhatsApp-verified until
  a real availability check. Preview is the default, with explicit recipient/text
  review before live sending. No live sends during development.
- Maintain a private outreach ledger, separate from enquiry counts. Persist an
  operation identity before sending, deduplicate by sender/number/purpose, retain
  ambiguous sends for reconciliation, and update delivery/replies only from actual
  router evidence. Poll only selected campaign contacts; no unrelated chats.

## Validation and delivery

Use local response fixtures and fake transports for collection, attribution, masked
numbers, blocked/auth/credit failures, cancellation, data migration/copying, exports,
router idempotency, wrong-session data, receipts and interrupted sends. Run the
existing portal suite and terminal/controller smoke checks. Then make at most a few
explicitly bounded public Firecrawl reads, report actual contacts/credits/limits,
and verify that no portal enquiry or WhatsApp message was sent. Package/install the
local update while preserving configuration, browser profile and saved run files.
Record measured results and remaining live-router boundaries in a Markdown report.

The external router implementation/deployment remains the other developer's job.
No automatic Firecrawl or WhatsApp background work starts merely by opening a run.
