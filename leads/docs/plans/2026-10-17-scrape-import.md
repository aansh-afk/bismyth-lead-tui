# Scrape directly into source-linked contacts

Pressing Scrape in the TUI fetches one source, extracts records, and immediately imports eligible phone contacts as inactive relationships. The request explicitly opts into importing; read-only API scraping and website crawling/batches keep their existing behavior. Directory/site contacts are excluded and phone-less records remain in source research.

Persist one contact-to-source record per phone relationship and source URL, including title and extracted evidence. A duplicate phone keeps its CRM fields, stage and permissions, while gaining the additional source attribution. Deleting source research preserves the imported attribution, and backups/restore include it.

Return the saved page ID and import summary, select the newly scraped source, show linked CRM contacts on that page, and display source links in the contact preview. If scraping succeeds but local import fails, retain the page and report the import error without implying that another paid scrape is needed.

Verify automatic imports, read-only API compatibility, duplicate attribution/idempotency, site-contact exclusion, phone-less results, deletion persistence, additive migration/restore and the native mouse workflow. No live scrape, customer import or messages during development.
