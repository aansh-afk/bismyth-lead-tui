# Square Yards account and passive badge verification

Date: 2026-10-16. Package: 0.1.17.

## Problem and root cause

The user supplied a Square Yards `/user/my-portfolio` screenshot showing an authenticated account layout, visible Logout and a small reCAPTCHA badge. The account observer treated any visible reCAPTCHA iframe/container as an active security challenge, taking precedence over login evidence. Square Yards also renders its logout menu as a plain div, which the generic semantic-control detector missed.

A loopback reproduction used the installed v0.1.16 class and patched v0.1.17 class against the same synthetic portfolio/sidebar and passive badge. The installed version returned `blocked`; the patched version returned `signed-in`. No real login, provider interaction or account data was involved.

## Change

Passive invisible reCAPTCHA anchors and badge-only containers do not create a blocked result. Visible image/audio challenge frames, checkbox widgets, hCaptcha/Cloudflare frames and explicit security headings/titles still take precedence. The observer does not click or solve any challenge.

Square Yards account recognition accepts its verified authenticated header with its owned logout menu, a visible official plain-div logout control, or the exact portfolio route together with visible Profile/My Portfolio/Logout labels. A URL, bare avatar, guest navigation or hidden unowned logout alone is insufficient. The fix applies to account verification; Square Yards remains login-only.

## Evidence and verification method

- User-provided screenshot: authenticated portfolio context with visible Logout and passive bottom-right badge. The screenshot and account identity are not included in this repository.
- Official Square Yards frontend: https://www.squareyards.com/assets/js/common-global-3f8bf6fbd7.min.js . `renderUserHeaderMenu` creates the authenticated `.headerProfileBoxParent.withUserProfile > .headerProfileBox` with its `.profileDropdownBox`; logout uses `.lgnDsktpDrpdwnUl li.userLogout .logOut`. No input/account values are read by the observer.
- Public unauthenticated access to the portfolio URL redirected to `/user/login`; this is not a live authenticated-session verification.
- Google background and invisible-widget documentation: https://developers.google.com/recaptcha/docs/v3 and https://developers.google.com/recaptcha/docs/invisible .

Local Chromium fixtures use only loopback iframe resources. Twenty-seven cases cover passive branding, guest state, the screenshot layout, actual Square Yards header/menu structure, hidden/stale markup, portal isolation, visible challenges including frames inside badge wrappers, and gate priority. Every check asserts zero clicks, navigation, additional requests, fetches or credential-value reads.

## Measured results

- Focused account/discovery suite: 38 passed; 0 failed; 15.795 seconds.
- Before/after reproduction: installed 0.1.16 `blocked`; patched 0.1.17 `signed-in`.
- Full regression suite: 279 passed; 0 failed, cancelled or skipped; 143.872 seconds.
- TypeScript build, installer shell syntax and git whitespace checks passed.
- Archive: 35 files; 108538 bytes. Tests, maps and credential files excluded; zero occurrences of the actual saved Firecrawl key.
- SHA-256: `83b19d4f471f6a70abe4d115f49d7777a865667f5c3930057fa5b96c7f8b319f`.

## Limits

The user's authenticated browser session has not been directly inspected or changed. After updating, restart the TUI and press C for Square Yards on the existing account page. Actual challenges remain manual browser steps. No live enquiries, Firecrawl scrapes, WhatsApp sends or account submissions were performed. Saved profiles, keys and runs must remain unchanged across installation.

## Public release and laptop update

Source commit: `28f1656`. Public release: https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.17 . Anonymous download matched the recorded SHA-256. The pinned public installer updated `/home/aansh/.local`; the installed command returned `0.1.17`, and its account observer JavaScript matches the tested release build. All 18 saved profile/account/run/credential files remained byte-for-byte unchanged. Source, tests, docs and the archive were synchronized to the local TUI workspace.

The currently running TUI must be quit and reopened to load this update. In website logins, select Square Yards, Enter opens the retained session, and C verifies the page. A successful private live-account check remains for the user to perform.
