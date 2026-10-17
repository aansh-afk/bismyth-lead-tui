# Named source contacts and company relationships

Use Firecrawl v2 JSON extraction alongside markdown and links. Preserve explicit names, roles, company affiliation, emails, phone numbers and quoted evidence; validate extracted identifiers against page content. Unknown person names stay unknown. Shared company phones must not turn several employees into a guessed individual owner.

Keep the existing source-page JSON storage compatible. Build a contact/company catalog from those records, deduplicating identical people while retaining each source URL. Group companies using an explicit website when supplied, otherwise the source domain and company name. CRM imports remain phone-based and inactive, preserve duplicate records, and carry affiliation/role/email/evidence in their saved context. Email-only records remain available in research exports.

Add bounded Firecrawl batch scraping for saved discovered results, persisted remote IDs, restart-safe polling/cancellation and progress. Keep whole-domain crawling. Add per-page and all-source deletion with confirmation; block deletion while research is active to prevent late results restoring deleted pages. Imported CRM contacts and their memory survive source deletion.

Add terminal actions for contacts, companies, collect saved results, bulk import, export, and deletion. Verify with synthetic structured extraction, shared phones, unrelated company names, multiple sources, email-only records, batch pagination/restart, delete races, and native mouse/keyboard interaction. No live messages or paid requests during verification.

References: https://docs.firecrawl.dev/features/llm-extract and https://docs.firecrawl.dev/api-reference/endpoint/batch-scrape
