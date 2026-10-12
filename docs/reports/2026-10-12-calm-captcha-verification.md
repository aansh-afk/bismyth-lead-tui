# Calm browser interaction verification

## Setup and observed failures

Package: `tools/lead-tui`, version 0.1.10; Node, TypeScript and installed Playwright Core 1.64.0; real headless Chrome against isolated local HTTP fixtures. No live portal enquiries or flashing live challenge experiments.

The user's native version 0.1.9 run recorded actual GPT-6 Luna low reasoning calls, varying tile lists and an all-nine-tile answer. Several logged lists were discarded as stale; the old log reported selections before checking freshness. These events establish that model requests ran, not that their object recognition was correct. The active app PID 1064813 was stopped via its SIGTERM handler. The run was saved as stopped with `Stopped; progress saved.` Personal-profile SHA-256 before upgrade: `8ff2ed4bbe54bb34940ff6ab1ebbd13c75482977d896a6c3b468f6b3ef196d10`.

Installed Playwright's screenshot implementation calls `_waitAndScrollIntoViewIfNeeded` for element screenshots and does not restore scroll position. The old CAPTCHA loop took a panel screenshot, nine/sixteen tile screenshots, a second panel screenshot and more tile screenshots before actions. This can scroll a short iframe repeatedly. Whole-panel PNG equality also reacts to harmless hover/decoration changes. There was no explicit per-tile pacing.

## Changes and method

Capture the complete panel once using `page.screenshot({clip, caret: 'initial'})`; no element screenshots. Check the iframe viewport, page viewport, ancestor clipping/occlusion and tile containment. Revalidate after the last pause/wait immediately before tile/Verify clicks. Fingerprint requested instructions, image URLs, dimensions and sprite crop offsets; ignore hover outlines and selected zoom. Reject nested/canvas/partial panels without scrolling.

Default browser actions are spaced by at least 1000ms, with 1500ms after a selection batch. Reject selecting every tile and no-progress answers, cap eighteen actual tile clicks, stop after three consecutive stale answers, and apply Verify only once to an unchanged grid. Actual applied tile clicks are logged separately. Runner P/S checkpoints now reach the CAPTCHA action loop.

The injected-solver tests measure browser mechanics independently of model decisions. The optional real-subscription test uses synthetic red/blue image tiles and checks configured Luna low reasoning plus fixture acceptance; it does not establish accuracy on street scenes or live provider clearance.

## Results

Initial CAPTCHA/core run: 51 tests passed, zero failures/skips, 102.083 seconds. Initial no-scroll/pacing suite: 12 tests passed, zero failures/skips, 23.560 seconds. Independent review then identified post-pause freshness, post-inference visibility, parent clipping and same-source sprite-offset gaps; these were fixed and new regression cases added before the final suite.

Focused final mechanics suite: **16 passed, zero failures/skips, 34.454 seconds**. Measured default tile-click spacing: **1142.2ms**. Cases cover element-screenshot prohibition, zero page/frame scrolling, iframe/main/parent clipping, nested grids, hover, same-source sprite offsets, all-tile/no-progress guards, Stop mid-gap, pause/resume, instructions changing while paused and unchanged Verify once. Independent rereview found no remaining release blocker. The pause-mutation fixture does not specifically force the former final-helper-checkpoint race; the helper now revalidates after its final checkpoint structurally.

The first full run with real vision enabled counted **129 tests: 127 passed, 2 failed, zero skipped, 120.503 seconds**. Both failures correspond to the real-vision child and its containing parent: the synthetic grid produced an uncertain or invalid handoff rather than fixture acceptance. This failure was retained rather than changing the expected acceptance assertion.

A diagnostic repeat saved the exact synthetic model-input crops and called the real subscription solver. Visual inspection confirmed a complete, legible nine-tile red/blue grid. Luna returned `{"action":"select","tiles":[1,3]}`, followed by `{"action":"verify","tiles":[]}`; the fixture accepted it. The vision case completed in **21.021 seconds**. That rerun counted **25 passed, zero failures, 1 unrelated name-pattern skip**, in 116.580 seconds including other browser cases. This demonstrates variability, not established recognition reliability. Synthetic captures are `/tmp/bismyth-v0110-synthetic-1.png` and `-2.png`; no real user browser challenge was captured.

The final tarball has **26 entries, 69,101 bytes**, SHA-256 `6eb247b24692ae3d893c98fd08f9556269abab77f364618ae4bef576250e3a8c`. A clean npm prefix installed the artifact with lifecycle scripts disabled. Doctor confirmed Chrome, saved ChatGPT login, Luna Low and disabled automatic audio against isolated app data. A terminal smoke check launched Setup and exited with Q, restoring terminal mode. `git diff --check` passed.

Final ordinary suite after all fixes: **128 tests passed, zero failures/skips, 116.011 seconds**. The default-spacing measurement in this run was **1459.1ms**. This suite uses injected model decisions for browser mechanics and separate fake-CLI checks for model/auth configuration; the real vision observation is reported separately above.

Published source commit `739a616` and [release v0.1.10](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.10). GitHub's asset digest matches the tested tarball. The public tagged installer was byte-identical to the tested source installer and upgraded the user's `~/.local` installation to **0.1.10**. Installed CAPTCHA and Runner runtime files match the built release exactly. Doctor confirmed saved ChatGPT login, Chrome, Luna Low and automatic audio disabled; the previously configured optional audio helper remains unused. All ten saved runs are preserved. Personal-profile SHA-256 after installation matches the pre-upgrade hash exactly. The old app PID is no longer active; run `bismyth-leads` to load the update.

## Limits

Guarded model output can still identify a wrong object. An all-tile answer may occasionally be correct; this version deliberately hands it off rather than clicking everything. Freshness metadata does not detect pixels changed behind an identical URL/crop; canvas challenges are unsupported. Visibility checks conservatively hand off clipped/nested/occluded grids. Pause holds subsequent actions, but a dispatched click can finish. No live 99acres acceptance or measured flash-frequency result is claimed.
