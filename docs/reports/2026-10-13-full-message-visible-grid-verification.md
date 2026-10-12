# Complete diagnostic messages and visible-grid capture

## Observations and method

The user reported `The complete image grid is not visible or uses an unsupported canvas...` with the remaining TUI message truncated. They confirmed the entire image grid was visible in Chrome. Installed version was 0.1.11; run `9e7db251-83a2-4558-99ae-fcaa101d94f3` recorded the same ambiguous guard twice. The native browser's exact layout was not inspected.

The footer used `cell(notice, width - 4)`, always truncating the reason to one row. The capture guard required the entire `#rc-imageselect` dialog, including footer/tab-loop content, to fit inside the iframe.

Read-only inspection of the saved Google runtime/stylesheet found table margins of -2px for 3×3 and -1px for 4×4 layouts. A local reconstruction using that styling measured a 4×4 root bottom of **581px** in a **580px** frame while all tiles ended by **512px**. Thus the whole image content can be visible even when an unrelated footer fails the old guard. This proves a false-rejection class, not the exact cause in the user's native window.

Testing uses Node/TypeScript, Playwright Core 1.64.0, local HTTP/headless Chrome and an isolated terminal waiting-run component. There are no live CAPTCHA actions, real model requests or portal enquiries in the new checks.

## Changes

Wrap the footer message and its controls, allocating body rows accordingly. E opens the complete message, with scrolling and hard wrapping for long URLs/tokens; E/Esc returns. Preserve current/paused run controls and dismiss stale message details after the handoff changes. The latest activity remains visible as the footer grows.

Capture one non-scrolling viewport crop containing the complete instruction and all tiles. Exclude irrelevant root/footer corners. Validate tile/Verify control visibility separately after the final pace/pause checkpoint. Canvas, nested frame, clipped content, out-of-viewport and page obstruction failures each produce a specific reason. Genuine clipped images still receive no inference or tile clicks.

## Results

The initial combined UI check counted 40 tests: 38 passed and two old copy assertions failed after the footer and resize label changed. Expectations were updated to the actual Recheck/resize wording. Six new renderer cases passed across **70×22, 80×24, 100×30 and 180×40**, covering the previously hidden message ending, long diagnostics, full controls, long URLs, Unicode letters and terminal-control sanitization.

The isolated keyboard smoke passed: E opens, End/Home/Page Down scroll, Esc returns, Q restores raw/alternate terminal mode and closes the fake driver exactly once. No browser action is permitted in that component. Capture log: `/tmp/bismyth-v0112-ui-smoke.log`.

The new headless capture fixture passed **7 tests, zero failures, 6.316 seconds**. The same fixture against an isolated copy of installed 0.1.11 failed both complete 3×3/4×4 content cases because inference was never called; four other cases retained ambiguous old reasons. The old run counted seven failing tests including its parent, **7.823 seconds**. The corrected checks cover footer overflow, complete screenshot coverage, genuinely clipped instructions/tiles, canvas and parent obstruction. Both runs performed zero tile clicks, model requests and page/frame scrolling.

Final full suite: **161 tests passed, zero failures/skips, 134.613 seconds**. Compilation and `git diff --check` passed. The tarball contains **26 entries, 72,977 bytes**, SHA-256 `9e37797149df465a4985a440bc8058a387ddaebb84e788902e1c271596d95b7d`. Clean-prefix installation with lifecycle scripts disabled passed; doctor confirmed Chrome, saved ChatGPT login, Luna Low and automatic audio disabled against isolated data.

Published source commit `a4e3ec8` and [release v0.1.12](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.12). GitHub's asset digest matches the tested tarball. The tagged public installer matched source and installed **0.1.12** under the user's `~/.local`. Installed CAPTCHA, TUI and terminal-renderer runtime files exactly match the tested artifact. Doctor confirmed Chrome, saved ChatGPT login and unchanged Luna/audio configuration. All twelve saved runs remain present; the personal-profile hash remains `8ff2ed4bbe54bb34940ff6ab1ebbd13c75482977d896a6c3b468f6b3ef196d10`. Installation did not stop the native app/browser; Q/relaunch loads the new message view and capture guard.

## Limits

The visible-grid correction is reproduced locally using saved vendor styling. Live 99acres acceptance and model recognition accuracy remain unverified. Nested/canvas formats are still unsupported and now identified explicitly. Terminal wrapping counts code points and was tested with ASCII and accented Latin text; it does not establish full East Asian/combining-character cell-width support. A running TUI requires Q/relaunch to load the installed update.
