# Google image-dialog selector correction

## Confirmed cause

The user supplied a terminal screenshot showing version 0.1.8 waiting thirty seconds, then reporting “no visible image panel.” They confirmed that Chrome actually displayed an image grid. The detector searched `.rc-imageselect`, while Google's root dialog uses an ID with no class.

The exact script loaded by the shared 99acres browser was [Google's reCAPTCHA runtime](https://www.gstatic.com/recaptcha/releases/nY0xPItgwtktOA7U0o-VsaLz/recaptcha__en.js). Its dialog opening tag at offset 187104 is `<div id="rc-imageselect" aria-modal="true" role="dialog">`. The first class belongs to a child element. The corresponding [official stylesheet](https://www.gstatic.com/recaptcha/releases/nY0xPItgwtktOA7U0o-VsaLz/styles__ltr.css) uses `#rc-imageselect`, with no `.rc-imageselect{` root rule. Official runtime table and tile selectors match the existing tile controls.

Prior local fixtures used the same class-only assumption as the detector. Consequently their passing results did not establish compatibility with Google's actual dialog root. This was a test-fixture mistake, not evidence that increasing the wait had fixed live detection.

## Change and method

Version 0.1.9 uses `#rc-imageselect, .rc-imageselect` consistently for grid readiness, CAPTCHA detection and the checkbox guard. Image-only mode, thirty-second image waits, 180-second Luna requests, retry limits, subscription authentication and provider/portal acceptance checks are unchanged.

Default Chromium fixtures now use Google's ID-only dialog. Separate 3×3 and 4×4 fixtures use table-cell tiles, loaded synthetic SVG images, dialog accessibility attributes and an audio alternative that must remain untouched. A separate legacy class test preserves compatibility.

An isolated runtime with the installed 0.1.8 CAPTCHA engine ran those three regression cases. Both ID-only grids failed with the exact missing-panel message, while the legacy class case passed. This reproduces the reported selector failure independently of model latency.

The full suite enables real saved-ChatGPT-login Luna Low inference through an ID-only synthetic dialog. Packaging and clean-prefix validation follow the existing release process. No live property enquiry is submitted.

## Results

The old-runtime reproduction failed the two ID-only subtests as expected; legacy compatibility passed. TypeScript compilation passed.

The corrected full suite with real subscription vision enabled passed **111 tests, 0 failures, 0 skipped**, in **222.031 seconds**. Both ID-only table sizes and the legacy class case passed. The real Luna Low ID-only synthetic challenge completed in **17.379 seconds**, including image decisions, browser selections and fixture acceptance. These are single observations, not a throughput benchmark.

The built tarball contains **26 entries**, is **66,596 bytes**, and has SHA-256 `4225ec8d8ffa54edec9ef70e61768497f47715e05f40e7d74c34f2cee96a888c`. A clean npm prefix installed version 0.1.9 with scripts disabled. Its runtime contains the corrected ID/class selector and image-only browser default. Doctor reported Chrome, saved ChatGPT login, Luna Low and automatic audio disabled against isolated app data. `git diff --check` passed.

Published source commit `49484b5` and [release v0.1.9](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.9). GitHub's asset digest matches the tested tarball. The public source-pinned installer upgraded the user's `~/.local` installation to 0.1.9. The installed runtime contains the Google dialog ID selector and still has no default audio solver. The personal-profile SHA-256 is unchanged. The tagged installer is available and byte-identical to the script used for the upgrade. The existing TUI was left running and must quit/relaunch to load the corrected detector.

## Limits

This fix is grounded in Google's actual runtime markup, and the user confirmed the image-grid state. It does not establish successful acceptance by the live 99acres provider. The shared preview remains at its security page; no live CAPTCHA clearance or enquiry submission is claimed. A running installed app must restart to load the corrected selector.
