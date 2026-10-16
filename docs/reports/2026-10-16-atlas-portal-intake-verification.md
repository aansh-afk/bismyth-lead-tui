# Atlas portal lead intake verification

Date: 2026-10-16. Package: 0.1.19.

## Objective checked against the transcript

The user's latest clarification is that the goal is selling Atlas. The original transcript at 01:06:58 corrects the scrape-and-call interpretation: distribute the chosen callback number through property lead-intake forms so sales teams contact it. At 01:08:12–01:10:14 Aansh owns the browser CLI and Stoops owns the WhatsApp engine/agent. The user's subsequent requests extend the website coverage to all seven portals and add capture of contact details revealed through the authenticated website flow.

The TUI therefore records confirmed interests, outgoing portal messages, real viewing bookings, captured contacts and WhatsApp/referral outcomes separately. A discovered property, clicked button, phone reveal or old confirmation is not a qualified Atlas lead. The separately hosted WhatsApp agent and CRM are not implemented or deployed by this patch.

## Implemented behavior

- Verification controls on the four added portals are left to the operator in Chrome; the new flows do not invoke an automatic challenge solver.
- All seven portals have listing/import/contact definitions, while discovery still accepts only selected, normalized signed-in observations. `all` in the Websites field selects the catalogue. OLX location and non-Mumbai Quikr search filters require an explicit browser confirmation because the available entry URL does not establish those filters.
- Exact Contact labels precede optional AI selection. Final submit is scoped to the prepared form/dialog. Unscoped final controls must be unique. Static headings, ambiguous Submit buttons and disabled controls are not chosen as substitutes.
- NoBroker Contact may open its scheduler. The helper selects the latest available date/time, respects CSS-disabled controls and waits for asynchronous slot rendering. Test mode does not click Confirm Booking. Send mode clicks it once and requires fresh visible `#scheduleVisitModalConfirmation` evidence. Existing visits, rescheduling and ambiguous outcomes do not retry automatically.
- NoBroker bookings use the website account's registered number. They do not establish that the callback number configured in the TUI was shared. The run chooser and documentation identify the real appointment; results count bookings separately from callback interests.
- Confirmed submissions collect visibly revealed listing contacts. NoBroker also reads the matched `/profile/myContacts` property card, using its official desktop phone-copy control. The collector intercepts that specific in-page copy operation without reading or changing the operating-system clipboard. Wrong/ambiguous cards and narrow/mobile layouts do not trigger a phone action.
- Browser contact evidence records authenticated/public visibility, collection method and associated property URL. It stays local and is never sent to Firecrawl or the public-contact classifier. Hidden/masked, support, login/profile-dialog and unrelated-card numbers are rejected, as are the supplied callback details.
- Contact-capture failures and cancellation retain a confirmed submission. Contacts merge with existing evidence and approval; optional Firecrawl collection does not replace authenticated evidence.
- OLX has a separate seller-chat flow. The exact Atlas business introduction includes the chosen callback number and email. Test mode drafts only. Send mode clicks the scoped Send once, then requires fresh outgoing-message UI evidence without a pending/failed marker. The attempt guard is scoped to the conversation URL, so another listing can receive its introduction. An existing identical introduction is skipped.
- The existing Baileys client continues to require contact review and explicit reviewed-message sending, with persistent duplicate protection, availability checks and opt-out handling. An extracted portal number can be a relay and is not assumed to identify a direct seller or a WhatsApp account.

## Primary website evidence

The user supplied screenshots showing NoBroker's two controls, scheduler, scheduled confirmation and contacted-properties page. The actual public listing inspected in the collaborative preview confirmed that Contact and Schedule Visit both use `id=getOwnerDetails`; the source does not prove that the application deliberately selected the Schedule Visit label. Contact itself can enter the scheduler.

Official NoBroker public assets show `.calender-compoent`, `.visit_schedule_container`, CSS-disabled date/time controls, exact Confirm Booking, and `#scheduleVisitModalConfirmation`. The authenticated-profile frontend wraps each property in `.nb__ZsnRA` and delegates the phone icon to the normal desktop copy handler. Both phone and chat images misleadingly use alt="chat"; the phone image source ends `/List-Page/callIconActive.svg`. The official component is https://assets.nobroker.in/nb-new/PropertyCardOtherDetails/PropertyCardOtherDetails.e9f8107a486731d40149.chunk.js . No hidden account-state phone values are read directly.

The catalogue retains its official evidence URLs in `src/portal-catalog.ts`. Read-only public fetches observed Square Yards, Magicbricks and OLX listing/search pages with HTTP 200. Quikr direct fetch returned HTTP 403; official indexed pages establish the candidate navigation and contact labels, not live authenticated success. These observations are not an authenticated seven-portal end-to-end test.

## Verification method and measured results

All submissions, bookings, chat messages, contact-copy operations and router sends in automated tests use local loopback fixtures or mocked drivers/routers. No live enquiries, viewing appointments, WhatsApp messages, login/OTP actions or Firecrawl credit requests were performed for this patch.

Focused development checks:

- Contact provenance, existing extraction and outreach: 32 passed; zero failures; 0.407 seconds.
- NoBroker scheduler: 4 passed; zero failures; 9.277 seconds.
- Contact capture and workflow: 18 passed; zero failures; 14.983 seconds.
- Catalogue and portal chat: 13 passed; zero failures; 14.066 seconds. The subsequent failed-message aria-label/title case also passed.
- Six-portal enquiry forms plus NoBroker booking integration: 14 initially passed; zero failures; 58.763 seconds. Strengthened stale-parent and asynchronous scheduler checks are included in the final suite.
- Safety regressions: 6 passed; zero failures; 8.997 seconds.
- Initial full suite: 356 passed; zero failures; 138.058 seconds.
- The expanded 358-test run exposed one overly broad exclusion that discarded a valid seller contact when a profile panel was nested in its section (357 passed, 1 failed). The scope filter now builds evidence from allowed visible text only. Fresh capture/safety checks passed 16/16 in 13.629 seconds.
- Final combined regression and 100/200/300 batch run: **361 passed**, zero failures/cancellations/skips; **430.191 seconds**. This uses the complete main test list plus the batch file against one compiled build.
- The read-only verification guard for the four additional portal hosts was added separately: its final publication-clone check passed **1/1** in **2.345 seconds**; the workspace build also passed the same check. No controls or model decisions ran in these guard fixtures.
- Batch totals: 100 Preview preparations with **zero** fixture submissions; **600** confirmed configured-callback submissions and seller captures across batches of 100, 200 and 300; zero duplicates on each saved-run resume. Fixture Submit phases measured 58.891, 107.560 and 165.370 seconds, respectively.
- A real 120×40 pseudo-terminal opened the source TUI with synthetic saved data: Ctrl+R displayed the chooser, Escape cancelled, reopening worked, Q exited with code zero, fixture JSON was unchanged and no browser started.
- Both TypeScript builds, installer shell syntax and git whitespace checks passed. Archive JavaScript matches both tested builds.

The development checks found and fixed stale confirmation ancestor text changing when a phone appeared, initial verification gates retaining the previous listing's state, an empty-baseline handoff accepting old success, ambiguous unscoped final Submit controls, account-dialog contact leakage, a recheck loop for an existing introduction, and a send-attempt key that prevented later conversation URLs. One intermediate account-dialog failure ran against stale emitted JavaScript while parallel builds overlapped; after source freeze, the fresh six-test run passed. No failing check is being treated as a successful live submission.

## Limits and follow-up

Authenticated live flows on the user's accounts remain unverified. Website UI changes, OTPs, real security challenges, plans and search filters may still require a browser step. The eight-second NoBroker slot wait stops safely when slot data cannot be established. Portal message evidence is an observed outgoing UI acknowledgement, not seller delivery/read proof. All seven adapters have fixture coverage; the new public catalogue does not guarantee seven live integrations.

The archive contains 39 files and 123457 bytes; tests, source maps, credentials, profiles and the actual example phone supplied by the user are excluded. Actual saved-key occurrence scan: zero. SHA-256: `642771cff60802b725dda242b1f265968369be56e0b8626c3471c3a71624348b`. Source commit: `0376c15` (`feat: connect portals to Atlas lead intake`). [Release v0.1.19](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.19) and its annotated tag were pushed successfully. The archive was downloaded anonymously from the public release and matched the SHA-256 above. The pinned public installer passed shell syntax validation and installed the package under `/home/aansh/.local`; the installed command reports `0.1.19`. All 39 installed package files match the downloaded archive byte for byte.

The installed command passed the same real 120×40 pseudo-terminal check: Ctrl+R opened the chooser without returning to Setup, Escape cancelled and allowed reopening, Q exited with code zero, synthetic saved JSON was unchanged and no browser started. A fresh private-data snapshot immediately before installation compared 20 files (configuration, account observations, saved runs/exports and the Firecrawl credential): zero changes and zero additions afterward, including permissions. Existing website selections, contact details, secrets and run data were retained. No running user TUI or Chrome process was terminated or reloaded. Updating the installed package does not reload an already running TUI; quit and reopen `bismyth-leads` to use the new code.
