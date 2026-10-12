# Image-only Luna timing and control verification

## Confirmed failure and resulting behavior

The latest saved 0.1.7 run logged image waiting at 17:02:52.887, a missing-grid result at 17:03:03.571, then a switch to audio. No Luna analysis event appeared. The observed failure was before model invocation; extending only the model deadline would not resolve it.

Version 0.1.8 removes the audio solver from normal browser runs. Missing images, uncertain output and model errors never trigger an audio click, audio download or speech request. An already open audio challenge returns to images through an observed enabled image button once, or reports that image mode is unavailable. Existing audio helper code remains only for compatibility and explicitly injected helper tests.

Image loading allows 30 seconds, each Luna Low request allows 180 seconds, and a cycle allows up to 12 decisions within 600 seconds. Contact-control calls retain their 90-second deadline. These are maximum budgets; ready images and completed responses continue immediately.

All eligible visible panels are inspected and hidden tiles are excluded from numbering. Unloaded rendered images delay inference; images under hidden wrappers do not block it. Model answers are validated, provider tokens/blocks are checked again, and stale panels or refreshed tiles trigger fresh screenshots and decisions. Verify allows an asynchronous acceptance response even on the last allowed decision. Activity records loading diagnostics, request budgets, answer arrival, selections and Verify.

## Method

- Chromium fixtures use a real nine-second delayed grid with a visible audio button; premature audio would deliberately cause a provider block. The normal path must complete without audio or reload clicks.
- Default missing-grid, manual and model-error cases must make zero audio/reload clicks. Existing audio can return to image mode once, while a disabled return control is left untouched.
- Fixtures cover hidden legacy tiles, failed images under hidden wrappers, stale panels, dynamic tile refresh, instruction changes during activity persistence, bounded decisions, cancellation and delayed acceptance after final Verify.
- Fake Codex subprocess tests use virtual time to prove images remain active at 90 seconds and 179999 ms, terminate at 180 seconds, and retain 90 seconds for text calls. Cancellation after 120 seconds terminates the child and removes private inputs.
- A real saved-ChatGPT-login synthetic image test invokes GPT-6 Luna Low through the production screenshot, structured decision, selection and portal-acceptance path. No live property enquiry is submitted.
- Independent review checked default audio removal, budget interactions, stale results and cancellation before clicks. Package validation uses a fresh prefix and isolated app data.

## Results

Focused subscription tests passed **6/6** in **1.170 seconds**. Their first attempt had two fixture read failures when an appended capture record was incomplete; reading only complete newline records fixed the test harness. No production deadline failure remained.

The initial full suite with real subscription vision enabled passed **106 tests, 0 failures, 0 skipped**, in **94.106 seconds**. Its real Luna Low synthetic image path completed in **16.961 seconds**. The nine-second image-delay regression passed without audio; missing/uncertain/error cases, image-mode recovery and fresh captures passed.

Independent review identified the need to check cancellation immediately before tile clicks, ignore images under hidden ancestors, and wait for final Verify acceptance. Those corrections and two additional regression cases are included in final validation.

Final `npm test` passed **107 tests, 0 failures, 0 skipped**, in **104.869 seconds**. Compilation passed. This includes both added hidden-wrapper and final-Verify acceptance cases.

The tarball contains **26 entries**, is **66,466 bytes**, and has SHA-256 `a334e2c2bcb64d301d143989b825ac3a9ee3d23851777cbb97d5d88c144c6e30`. A fresh npm prefix installed version 0.1.8 with scripts disabled. Its runtime contains the 180-second image timeout, image-only browser default, 600-second cycle and twelve-decision bound. The installed doctor reports Luna Low and automatic audio disabled, and optional audio prerequisites are not required for image runs. `git diff --check` passed.

Published source commit `115eb36` and [release v0.1.8](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.8). GitHub's asset digest matches the local tarball. The public source-pinned installer upgraded the user's `~/.local` package to 0.1.8. Installed runtime checks confirm the extended image timeout and absence of a default speech solver in the browser. The personal-profile SHA-256 is unchanged. The tagged public installer is available and byte-identical to the script used for the upgrade. No TUI process was running at the final check; launch `bismyth-leads` to load the new code. The installed doctor confirms Chrome, saved ChatGPT login, Luna Low and automatic audio disabled; all eight saved runs remain present.

## Live observation and limits

The shared browser opened the live 99acres security page. It displayed an unchecked reCAPTCHA and a visible reCAPTCHA Enterprise free-quota warning. A coordinate checkbox action did not produce an observable state change; frame-locator click and read-only evaluation subsequently failed in the preview client. This is not evidence of CAPTCHA acceptance, nor does it establish that the quota warning caused the saved-run failure. No audio control was used in this live observation.

The release guarantees that the app's automatic flow does not attempt audio and that requests use the longer limits. It cannot force a provider to offer an image challenge or clear a provider block. Live 99acres acceptance remains unverified. A running app must quit and relaunch to load updated modules. The repair does not clear any saved run or modify entered personal details.
