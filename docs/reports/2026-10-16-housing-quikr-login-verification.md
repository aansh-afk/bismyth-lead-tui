# Housing/Quikr login and discovery verification

Version: 0.1.16. Date: 2026-10-16.

## Problem and resulting behavior

Housing's authenticated profile renders Log Out as a plain clickable div, which the semantic button/link detector missed. Quikr replaces its guest login entry with an account dropdown whose label can be MyQuikr or the user's name. The old generic text check missed that authenticated branch.

Housing now recognises its visible profile logout plus profile navigation, authenticated account-popover logout and authenticated greeting/Edit header. The Edit button is the adjacent sibling of its profile container in the shipped frontend. Quikr recognises its authenticated dropdown marker and mobile logout control. Checks remain read-only: no reloads, account clicks, credentials, OTPs or account values. Hidden logout markup, cookies, runtime flags and a profile URL alone are not authentication proof.

Discovery and URL imports intersect the user's selected listing websites with normalised signed-in observations from the TUI account snapshot. Unchecked, unknown, signed-out, blocked or skipped sites are excluded; selected preferences are retained. When no supported selected site qualifies, no run or browser job starts and the UI returns to website logins. Activity/notices identify skipped sites. Quikr, Square Yards, Magicbricks and OLX remain login-only integrations. Existing saved queues remain inspectable. A prior observation cannot guarantee a session will not expire later.

## Evidence and method

Observed the current public guest pages in the collaborative browser and inspected official shipped frontend code. No user credentials or account values were read and no login was attempted. The user supplied the Housing profile path and MyQuikr label. Sources:

- Housing profile: https://housing.com/user-profile/edit-profile and https://c.housingcdn.com/demand/s/client/shared/pages/UserProfile/desktop.e40bb2cc.m.d.js . The same profile URL is reachable by guests and displays a login-specific input, so the path alone is rejected.
- Housing account popover: https://c.housingcdn.com/demand/s/client/common/components/Menubar/rewrite/UserProfile.197fae6c.m.d.js .
- Housing authenticated header: https://c.housingcdn.com/demand/s/client/common/components/Menubar/rewrite/UserProfile/ProfileHeader/ProfileHeaderLoggedIn.172a4433.m.d.js .
- Housing edit form: https://c.housingcdn.com/demand/s/client/62303.1e191141.m.d.js . Normal NAME/EMAIL/PHONE controls are not treated as login fields.
- Quikr homepage https://www.quikr.com/ and header https://teja8.kuikr.com/module_assets/js/headerv1-18306587782b821dd3dd.js . Guest pages already contain a hidden dashboard logout; only the visible authenticated control counts.

Local headless Chromium fixtures reproduce authenticated and unauthenticated account structures. They cover 35 Housing and 31 Quikr table cases plus portal isolation, hidden/transparent ancestors, stale login markers, security gates and zero requests/clicks/value reads during checks. Nine access/controller tests cover filtering, selected order/deduplication, corrupt metadata, seed URLs, preserved settings and the no-eligible-sites stop.

## Measured checks

- Initial focused account/discovery suite: 37 passed; 0 failed; 13.564 seconds.
- Final focused suite after matching Housing's sibling Edit layout: 37 passed; 0 failed; 15.783 seconds.
- Full regression suite: 278 passed; 0 failed, cancelled or skipped; 141.573 seconds. The final Housing layout correction was additionally covered by the complete focused account/discovery rerun above.
- TypeScript build and package preparation passed.
- Package: 35 files; 108080 bytes. No actual Firecrawl key, credentials, test files or source maps are included.
- Package SHA-256: `b8d37907fbc15bb0f9356cfac8558ad7690488967de58c1e30bb87f343372c81`.

## Review corrections and limits

Source review caught the authenticated Housing Edit button being a sibling rather than a descendant; both production detection and fixtures were corrected and the complete focused account suite passed afterward. No tested failures remain in that scope. Opening Housing's Change Password/OTP account overlays can conservatively show signed out due to the existing credential-field rule; normal edit-profile fields are covered.

The user's live authenticated Chrome tabs were not inspected through the collaborative browser. Actual post-login confirmation therefore still requires reopening the updated TUI, selecting Housing or Quikr and pressing C on the account/profile page. The tests do not establish successful property enquiries, WhatsApp delivery or new portal adapters. No live enquiries, WhatsApp sends or Firecrawl requests were made for this patch.
