# API-first property discovery verification

Date: 2026-10-12. Package: `tools/lead-tui`, version 0.1.3.

## Change

Discovery reads the selected public search page and validates its city, intent and filters before using Housing GraphQL or NoBroker REST. API and browser listings merge through canonical project URLs. Activity records the source, request count, decoded JSON bytes and fallback reason. Contact forms and final enquiry submission still use Playwright and the existing run controls.

NoBroker anonymous requests stop after page 2. Housing pagination carries the observed response cursor. Both clients enforce an endpoint allowlist, same-site property URLs, a 2 MiB decoded response bound, request-count bounds and a 15-second request deadline. Stop cancellation propagates; unsupported or refused responses preserve earlier listings and use browser discovery. No dependencies were added.

Hostname aliases now canonicalize consistently, including old saved enquiry rows whose persisted IDs used a different hostname. Existing submitted and uncertain rows continue to prevent duplicate enquiries. NoBroker search URLs are distinguished from detail URLs.

## Setup and method

- Node 20.19.5, TypeScript 6.0.2, Playwright Core 1.64.0 and installed Google Chrome on Linux.
- Ran the complete package test command after the final source change. Chromium fixtures intercept all portal page requests, and API fixtures use local HTTP or injected responses. These tests use isolated storage and do not contact real sellers.
- Ran the real terminal app through a pseudo-terminal using `scripts/terminal_smoke.py` and isolated temporary storage.
- Used the T3 collaborative preview to evaluate the production public-context extraction callback on actual Mumbai Housing and NoBroker pages. No contact controls or account operations were invoked.
- Passed the extracted contexts to the production native API client without cookies or authentication headers. Compared Housing's exact request body with an anonymous curl request. Logged counts and timings, not contact data.
- Reviewed the integration and owned-timeout fix independently with a second agent.

## Automated results

`npm test`: **58 passed, 0 failed, 0 skipped**, elapsed 40.836 seconds, including nested Chromium CAPTCHA tests. TypeScript compilation passed.

API tests cover Housing cursor progression and repeated cursors, request budgets, NoBroker filter preservation and page limits, response/URL validation, malformed JSON and GraphQL errors, HTTP refusals, redirect refusal, partial-result retention, body-size limits, cancellation during response reads and the owned request timeout.

Six Chromium API integration fixtures cover saved discovery provenance, actual NoBroker SEO inline-state parsing, canonical search URL classification, partial API plus initial/later DOM merging, empty API results preserving initial DOM listings, and mismatched city or malformed public state falling back without API calls. These are controlled fixtures rather than claims of live portal completion.

Terminal smoke passed: ChatGPT connection indicator, State/City selection and persistence, advanced settings, URL import and queue review, saved history loading, CSV export, resize handling, keyboard help and clean exit. `git diff --check` passed.

## Package verification

`npm pack` built `bismyth-lead-tui-0.1.3.tgz`: 58,098 compressed bytes, 24 entries. The tarball contains the compiled listing API module, launch command, bundled location data and license files; it excludes source tests, local storage and credentials.

Installed that tarball globally into an empty temporary prefix using npm with install scripts disabled. Package metadata reported version 0.1.3, the compiled API module was present, `bismyth-leads --help` passed, and `bismyth-leads doctor` found Node 20.19.5, installed Chrome and the existing ChatGPT subscription login with zero saved runs in isolated test storage.

Tarball SHA-256: `58e410c76b385a4dab062776a9ddd2b81f6f8df527837c3f309060c380790ae6`.

## Live observations

| Check | Result | Time / size |
|---|---|---|
| Production public-context callback on Housing Mumbai page 2 | Valid Housing context extracted from active city/filter state | Browser inspection only |
| Production public-context callback on NoBroker Mumbai SEO search | Valid NoBroker context extracted from the public inline JSON | Browser inspection only |
| Native NoBroker discovery requesting 100 listings | 51 distinct valid detail URLs across 2 anonymous API requests; returned the documented sign-in-after-page-2 fallback reason | 515 ms; 764,802 decoded JSON bytes |
| Native Housing discovery before owned-timer fix | First request failed after 300,909 ms instead of the intended 15-second deadline | 0 listings; 1 request |
| Native Housing discovery after owned-timer fix | Returned timed-out fallback after 15,008 ms | 0 listings; 1 request |
| Anonymous curl using the same Housing query/variables | HTTP 200; 30 distinct listing URLs, no GraphQL errors | 678 ms; 815 compressed downloaded bytes; 4,180 decoded bytes |
| Anonymous curl forced to HTTP/1.1 | HTTP 200; the same 30 distinct listing URLs | 604 ms; 4,180 decoded bytes |

The original composed timeout did not fire in the observed Node request. An owned timer now retains its abort controller and clears in `finally`; both the deadline regression and the live timeout repeat passed. The cause of Housing's native transport failure is not established. Header-only diagnostic trials also did not establish a working native transport; one identifying product User-Agent received HTTP 429. No retries were added to evade that refusal.

The earlier public-API investigation records successful anonymous Housing browser requests and their pagination. This release's production native Housing transport remains unverified for successful listing reads; its bounded fallback is verified. NoBroker API success here does not establish access beyond its first two anonymous pages.

## Limitations

- 99acres continues through browser discovery; no working listing API was verified there.
- Live checks used Mumbai buy searches. Other cities, rent searches, full 100–300-listing native batches and live enquiry submissions were not established by this run.
- No real enquiry was sent. A queued listing or successful API read is not a submitted enquiry.
- Public endpoints are observed site interfaces rather than a supported integration contract and may change or refuse access.
- Decoded JSON bytes are payload measurements, not a full network-usage benchmark. No percentage bandwidth saving or overall enquiry-throughput improvement was measured.
- Existing ChatGPT-backed image CAPTCHA attempts retain their regression coverage. Live portal CAPTCHA acceptance and audio challenges remain unverified; the supplied Python audio solver was not copied or integrated.

## Conclusion

The release implements and tests API-first discovery with partial-result retention and browser fallback. Native NoBroker reads worked live, and Housing's native failure is now bounded to the intended deadline. These results support releasing the update while documenting the remaining Housing transport and live-portal limitations.
