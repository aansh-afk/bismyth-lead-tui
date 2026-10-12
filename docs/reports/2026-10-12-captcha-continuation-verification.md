# Browser-verification continuation

## Evidence and setup

The user reported Chrome completing verification, followed by `CAPTCHA attempt failed: frame.frameElement: Frame has been detached`. The running 0.1.10 app used run `3a283168-1b84-4ec8-beed-018633715525`. Saved activity recorded no-visible-image waits, a skipped first property and navigation to the next property. This confirms why Skip can cause another challenge; it does not establish the live site's acceptance state.

Source inspection found `await frame.frameElement()` outside the existing `.catch()`, an enabled-Proceed path reachable only through a top-level response token, a one-time Proceed enablement check, and a retry cap that could block manual clearance. Discovery also navigated to its current search URL again after a browser handoff.

Read-only inspection of the separate T3 shared 99acres preview confirmed a native `button#submit` named Proceed (`type=button`, disabled in that separate session). The preview is not the user's native app browser and was not used to complete a live challenge. Profile hash before upgrade: `8ff2ed4bbe54bb34940ff6ab1ebbd13c75482977d896a6c3b468f6b3ef196d10`.

## Method and changes

Catch detached frame/navigation transients, dispose enumeration handles and re-read acceptance/portal state. Follow enabled Proceed on a verification gate without requiring a top-level response token. Wait up to eight seconds for delayed portal enablement and gate exit. Keep disappearance/checked-checkbox-only gates pending. Suppress automatic repeat continuation after a stalled Proceed.

CAPTCHA-specific handoffs observe readiness every second and resume current-page preparation with `navigate=false`. Capture each handoff's resolver and cancel its observer after C/K/Stop; Pause suspends it. OTP/terms handoffs stay manual, and post-submit verification never submits again. Discovery retains a matching current canonical search URL. The image solver, model/authentication route and click pacing are unchanged.

Fixtures use real headless Chrome against local HTTP and fulfilled 99acres routes. One test physically removes an enumerated iframe while Playwright obtains frameElement and verifies the exact original error before the fix recovers. Other tests cover delayed/tokenless Proceed, navigation while waiting, manual completion after retry limits, stale unrelated frames, disabled gates, stalled continuations and search-page reuse. Injected solvers throw if inference occurs during a completed gate; no real model usage or portal enquiries are required.

## Results

Initial new browser continuation suite: 10 tests passed, zero failures/skips, 11.949 seconds. After adding disabled-Proceed token readiness and search reuse: 11 passed, zero failures/skips, 9.031 seconds. The final focused file including stalled Proceed passed **12 tests, zero failures/skips, 18.349 seconds**. The stalled gate received exactly one Proceed click, returned `continuationFailed` after about 8.457 seconds, suppressed automatic readiness on subsequent probes and restored readiness after actual gate clearance.

Core continuation checks initially passed 32 tests in 17.259 seconds; two added disabled-readiness/post-submit-OTP safety cases passed separately in 8.598 seconds. Final full suite: **148 tests passed, zero failures/skips, 119.310 seconds**. Compilation and independent read-only review passed, with no essential release blocker identified.

The tarball contains **26 entries, 70,741 bytes**, SHA-256 `7e2c95faa95dbabaa9a3b93484b80539d1710d88839dacec3fd1204416f9ba18`. A clean npm prefix installed the artifact with lifecycle scripts disabled. Doctor confirmed Chrome, saved ChatGPT login, Luna Low and automatic audio disabled using isolated test data. `git diff --check` passed.

Published source commit `1ec8e9d` and [release v0.1.11](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.11). GitHub's asset digest matches the tested tarball. The public tagged installer matched source and installed **0.1.11** under the user's `~/.local`. Installed CAPTCHA, browser and Runner runtime files exactly match the release. Doctor confirmed Chrome, saved ChatGPT login and unchanged image/audio configuration; eleven saved runs remain present. The contact-profile hash exactly matches the pre-install value. Native TUI PID 1094961 remained running, so installation did not close that browser session. Q/relaunch is required to load the updated modules.

## Limits

Fixture acceptance is not live 99acres acceptance. A server may still issue a fresh challenge for another property. Proceed must remain a portal-controlled enabled verification action, and successful enquiry confirmation remains separate. A running TUI uses its already imported modules until restarted. The active native session is preserved during installation.
