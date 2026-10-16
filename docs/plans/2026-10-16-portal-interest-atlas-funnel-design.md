# Portal interest submissions for the Atlas sales funnel

The user confirmed that the business objective is selling Atlas. The transcript at 01:06:58 explicitly corrects the initial scrape-and-call interpretation: submit the chosen callback number to property lead-intake forms so real-estate sales teams contact that number. At 01:08:12–01:10:14 Aansh owns the browser CLI; Stoops owns the WhatsApp engine and agent. The latest user request adds all seven portals and collection of contact details made available after an interest submission.

## Intended behavior

1. Select city, intent, supplied name/email/phone, websites and batch size. Use only selected portals with recorded signed-in observations.
2. Discover/import listing URLs, review the queue and choose Test forms or Send interests. Opening a phone number or chat alone is not proof the supplied details were shared.
3. Prefer deterministic exact Contact controls. Support ordinary forms across the portal catalog; keep OTP/security/unknown business flows as explicit browser steps. A click is never sufficient confirmation.
4. NoBroker's signed-in Contact route may open its viewing scheduler. Select the latest actually available date/time without confirming in Test mode. Clearly identify real viewing bookings in the run review. Only Send mode may confirm, once; compare fresh visible confirmation and do not automatically retry an uncertain booking.
5. After confirmed interests, collect listing-matched visible contact details in the same browser session. NoBroker may expose these on `/profile/myContacts`. Keep authenticated evidence distinct from public Firecrawl results, preserve property association, and never forward authenticated page text/cookies to Firecrawl or the public-contact classifier.
6. Make collected contacts available to the existing Baileys-router introduction flow. The business introduction names Atlas and asks for the person responsible for sales systems or a manager referral. Existing explicit send review, durable deduplication and opt-out handling remain. The separately hosted conversational engine remains outside this repository.

## Evidence and states

Keep enquiry confirmation, phone collection, WhatsApp delivery and manager referral as separate facts. Preserve confirmed enquiries when contact capture fails. Retain all contact provenance and existing operator approval on merge. A portal relay number does not establish a direct seller identity or WhatsApp availability. Provide actionable browser steps and keep partial queue progress when a site blocks automation.

## Verification

Use official public pages/assets and the user's screenshots to derive selectors, then exercise real Chromium against loopback fixtures for each adapter, scheduler, submission evidence and contact association. Verify Preview performs no final submission, submit confirms once, stale success does not count, invalid/hidden/unrelated numbers are excluded, and capture failure does not erase confirmed submissions. Build and regression checks must pass before publishing and updating the local command. Do not create real viewing appointments, live enquiries or WhatsApp messages as part of development verification.

## NoBroker date-label compatibility correction

The October 16 screenshot and current official ScheduleVisitNew asset show adjacent day/weekday spans with no separating text node (`16Today`, `21Wed`). Retain Playwright and the existing scoped scheduler; allow zero or more whitespace characters only between the strict numeric day and known weekday/Today suffix. Keep month/date validation, disabled-control filtering, latest-date/time selection, explicit final booking and duplicate protection unchanged. Match production markup in both helper and Runner/PortalBrowser fixtures, including the independent Join Visit card. This is a correction to the already authorized scheduling flow.
