# Image-first CAPTCHA regression verification

## Observed cause and change

The installed app was version 0.1.6 and contained the Luna Low invocation arguments. The user reported that it automatically selected audio, then displayed “Try again later.” Source inspection identified an image-loading race: the presence of an audio alternative button invoked audio before the image panel arrived, and an image panel with zero tiles triggered immediate fallback.

Version 0.1.7 waits for a visible 9/16-tile grid with loaded tile images before inference. An offered audio button is ignored during the eight-second image-loading window. Already visible audio answers and fallback after an actual image failure remain supported. Provider-block checks, bounded attempts and portal acceptance checks are retained.

Solver activity reaches the live TUI and saved run history: Luna Low analysis, selected tiles, image Verify and any audio fallback. Cancellation and screenshot freshness are checked after awaited activity writes and before clicks. The user must restart an already running app to load the updated modules.

## Method and measurements

Chromium fixtures offer an audio button before a delayed image panel, delayed grid tiles or delayed PNG images. Clicking audio deliberately produces the provider's block. Tests require two image decisions, zero audio calls/clicks, accepted provider token and navigation through portal Proceed. The image-loading case also proves images start unloaded and are complete before inference.

An isolated runtime with the installed 0.1.6 CAPTCHA implementation reproduced both panel/tile races: both regression cases failed with the exact provider-block reason. This confirms the fixture exercises the reported failure. Initial isolated setup lacked bundled India data; linking that data resolved the harness error before recording the reproduction.

The first full suite, with real subscription vision enabled, passed **93 tests, 0 failures, 0 skipped**, in **76.633 seconds**. Its real Luna Low synthetic challenge completed in **17.306 seconds**, including screenshots, model decisions and portal fixture acceptance. Activity included the Luna Low analysis and image Verify messages, with no audio-switch message. This single observation is not a throughput benchmark.

Independent review identified cancellation and instruction-freshness gaps introduced by awaiting activity persistence. These were fixed and two additional Chromium regressions added before final validation. An initial new rendering test used an incorrect view field and failed compilation; the field was corrected to match the existing renderer contract.

Final `npm test` passed **94 tests, 0 failures, 0 skipped**, in **59.384 seconds**, including the two new activity-boundary regressions. TypeScript compilation passed.

The final tarball contains **26 entries** and is **65,697 bytes**. SHA-256: `7d99b86dbe65737841395c7ee3125f0e02818b02bd4c0ef5aacfa2c53d90f4c1`. A clean temporary npm prefix installed version 0.1.7 with scripts disabled. Its runtime contains image-readiness waiting, Luna activity messages and runner activity wiring. Installed doctor validation uses isolated app data and the previously prepared private audio environment. `git diff --check` passed.

Published source commit `3a63b2c` and [release v0.1.7](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.7). GitHub's asset digest matches the local tarball. The public source-pinned installer upgraded the user's `~/.local` package to 0.1.7. Its installed runtime contains the readiness fix and Luna activity messages; the personal-profile SHA-256 is unchanged. The tagged public installer downloaded successfully and is byte-identical to the script used for the upgrade. Doctor checks reported Chrome, saved ChatGPT login and ready audio. The user's already running TUI was left running; it must quit and relaunch to load the new code.

## Limits

Fixtures demonstrate the race fix and configured model integration. Real 99acres CAPTCHA acceptance is not established. A provider block already encountered in an existing browser challenge remains a block; the fix prevents the premature audio switch on subsequent image challenges. No live property enquiry was submitted, no app run was cleared during this repair, and no global Codex model setting was changed.
