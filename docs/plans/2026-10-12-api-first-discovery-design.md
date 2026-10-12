# Approved API-first discovery

The user approved updating and building the verified API-first listing approach after the public endpoint investigation. Keep Playwright for search bootstrap, forms, authentication and CAPTCHA handling; fetch additional listing pages directly from verified public endpoints where possible.

## Implementation plan

1. Add a small native-fetch client for Housing GraphQL and NoBroker REST. Validate search context, response shape, same-site property URLs, GraphQL errors and bounded pages; use anonymous requests, request timeouts and cancellation. Carry Housing cursor metadata. Restrict anonymous NoBroker reads to the two observed public pages and preserve the browser sign-in path beyond them.
2. Extract the active Housing city/hash from public page state and the active NoBroker filter URL/state. Use the existing normalized project model and queue limits. Merge partial results with browser discovery when a schema or API request fails. Keep imported direct project URLs and 99acres on their current paths.
3. Report which discovery source was used and why fallback occurred in saved activity. Keep the existing contact/submission/confirmation boundary.
4. Test native HTTP clients and real Chromium integration with local fixtures, including pagination, malformed data, graph errors, refused/rate-limited responses, cancellation and DOM fallback. Recheck public Mumbai listing reads, build/package, and publish the update using the existing installation route.

No audio solver is bundled: the referenced repository uses another transcription service and has no declared license. The existing ChatGPT-backed CAPTCHA attempt path remains in place.
