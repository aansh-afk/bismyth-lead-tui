# Review queue Ctrl+R verification

Date: 2026-10-16. Package: 0.1.18.

## Problem and change

Ctrl+R on Review queue returned to Set up even when the relevant website login observations had been saved. `accountsReviewed` was initialized false each time the app started and only N/Escape finishing account navigation set it true. The shortcut gated even opening the harmless run-mode chooser on that transient flag.

The chooser now opens on Enter or Ctrl+R without changing the selected page, copying the run, writing data or starting a browser. Test forms remains the default, including for a saved submit-mode run. Starting a queued run checks normalized saved observations for every actual queue site and validates the saved contact profile before copying. Missing logins name the affected websites and offer L while retaining the page and queue. N navigates to the profile editor. Discovery continues to use only selected supported websites with confirmed login observations; no qualifying website still returns to website logins before a discovery run is created.

## Method and observations

- `npm run build`: passed.
- Initial focused account/controller/discovery/message suite: 30 passed, zero failures; 1.844 seconds.
- `node --test dist/tests/run-shortcut.test.js`: 12 passed, zero failures; 1.877 seconds. These tests feed actual Ctrl+R bytes (`0x12`) through Node readline and verify the decoded control modifier, default preview, explicit Send confirmation, cancelled/repeated shortcuts, missing or unobserved logins, invalid profiles, empty-queue discovery and edit/modal/active-run precedence. Runners are mocked and data lives in temporary directories.
- An isolated 120-column by 40-row pseudo-terminal ran the actual installed 0.1.17 command and patched 0.1.18 source. Each loaded a synthetic saved queue and saved NoBroker login, then received Ctrl+R. Installed 0.1.17 returned to Set up; patched 0.1.18 showed the chooser on Review queue. Escape cancelled, a second Ctrl+R reopened it, Q exited normally, all fixture JSON stayed byte-for-byte unchanged and neither process started Chrome.
- The initial ad-hoc terminal harness evaluated partially delivered redraws too early and failed its exit check. Waiting for the complete redraw before evaluating the frame resolved the harness issue. The final before/after terminal assertions passed.
- Current local metadata selects NoBroker and Housing, and both have recorded signed-in observations. This repair permits those observations to be used without pressing N again; it does not establish whether the live sessions have since expired.
- `npm test`: 291 passed; zero failed, cancelled or skipped; 148.262 seconds.
- Installer shell syntax, git whitespace checks and both publication-clone and workspace TypeScript builds passed.
- Archive: 35 files, 108717 bytes; tests, maps, local profiles and credentials excluded. The actual saved Firecrawl key occurs zero times in archive contents.
- SHA-256: `1324c63931aaf51f691440fe8ff5aa6b308543d89f99ddcaffd95b46fa205e68`.

## Limits and release checks

No live portal discovery, login, enquiry submission, Firecrawl request or WhatsApp message is required or performed for this shortcut repair. Browser adapters and enquiry processing are unchanged. A stored signed-in observation is not proof that a remote session remains authenticated. Expired or challenged sessions still require attention in Chrome.

## Publication and laptop verification

Source commit: `fbb551e`. Public release: https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.18 . The anonymously downloaded archive matched the recorded checksum. The pinned public installer updated `/home/aansh/.local`; `bismyth-leads --version` returned `0.1.18`, and the installed controller and package metadata match the tested build.

The installed command was also exercised in the isolated real pseudo-terminal: Ctrl+R stayed on Review queue and showed the chooser, Escape cancelled, reopening worked, Q exited with code zero, fixture data was unchanged, and no browser was started. All 18 existing user profile/account/run/credential files remained byte-for-byte unchanged across packaging and installation; the Firecrawl credential remains mode 0600.

Source, tests, package files, release archive and documentation were synchronized to the local TUI workspace. The parent homepage repository and the user's active terminal/browser processes were left in place. Quit the running TUI with Q, reopen `bismyth-leads`, and use Ctrl+R on Review queue to load this fix.
