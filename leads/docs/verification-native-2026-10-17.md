# Oracle Leads native terminal verification — 2026-10-17

## Scope and method

Dedicated outreach frontend built with Ratatui 0.29 and Crossterm 0.28. The Codex CLI remains the inference harness; this frontend does not embed the entire upstream coding interface. Applied the frontend-design skill to layout, density, hierarchy, colors and states. No upstream UI source was copied.

The native PTY scenario uses pexpect and pyte against the compiled executable, real HTTP API and SQLite store. SGR mouse escape sequences exercise actual Crossterm input handling. Synthetic contacts, model and transport are isolated in a temporary workspace. The real-service command scenario uses another empty temporary workspace, checks the startup provider picker and existing Codex login status, and verifies shutdown cleanup/backups. It does not generate customer messages.

## Results

- Service regression suite: 36/36 pass, 5.072 seconds. Includes scope revocation, sender changes, import inactivity, opt-outs, stale approvals, quiet hours, limits, uncertain sends, memory provenance, persistence and backup recovery.
- Native editor unit tests: 2/2 pass. Wide-character wrapping/caret positioning; vertical movement, newline preservation and control-character filtering.
- Rust `cargo clippy -- -D warnings`: pass.
- Source command real-service scenario: pass. Provider picker, four pages, live Codex sign-in status, 80×24 resize, shutdown, service-lock release and automatic backup.
- Release packing: 29 files; native Linux x86_64 binary plus Rust source/lockfile. No build target tree, dependency tree, SQLite database or private session key included.

- Packaged native PTY scenario: pass, **33 real SGR mouse clicks in 30.97 seconds**. Wheel selection, bracketed paste, multi-field focus/editing, permission cancellation/activation, permanent memory, local meeting, inline dashboard chat, exact-send cancellation/approval, one synthetic send, settings and 160×44 / 80×24 / 40×10 resizing. SQLite assertions verify 40 contacts, one meeting, one memory, one accepted synthetic outbound message and the edited company.
- Staged release command real-service scenario: pass, including the live Codex subscription login status and shutdown backup.
- Pre-install data preservation: all **6,939 existing files** match SHA-256, size and permission baselines; zero changed/missing.

The final frontend build repeated the full native scenario successfully: **33 SGR mouse clicks in 30.93 seconds**, with the same SQLite and resize assertions.

A final visual inspection of the captured terminal grid also led to proper multiline memory rendering and a shorter sidebar description. The global `~/.local/bin/bismyth-leads` command now reports Oracle Leads 0.2.1 and passes the real-service provider/page/resize/shutdown scenario. Its executable SHA-256 matches the current local build: `54bc3856bc0270cbfb2fff3168a289c4e72845fa07e928c40e17a8a19ccc4ea2`. After global installation, all 6,939 baseline files remain identical in SHA-256, size and permissions; zero missing/changed. Tests used temporary workspaces, so existing live relationship data was never opened by the test app.

## Failures found and corrected

- Overlapping composer hit area captured Send clicks. Explicit controls now take priority over enclosing regions.
- Bulk imports with equal timestamps appeared in unstable order. Contact lists now sort consistently by name/phone.
- Clicking a field label did not focus its editor. The whole field frame is clickable; the inner rectangle still determines caret placement.
- Replacing a running binary raised `ETXTBSY`. The build script now copies to a temporary sibling and atomically replaces the executable.
- Invalid local form input discarded the editor. Local validation preserves the form, and saving during an ongoing operation preserves its content.
- Opening a scoped conversation could lose the selected contact after filtering. Navigation now preserves the contact identity and explains when scope is inactive.
- Initial QA selectors matched explanatory copy or background labels. The PTY scenario now selects the intended visible controls. These selector failures were not counted as successful actions.

## Limits

A synthetic accepted send proves the UI/API dispatch path, not live WhatsApp delivery. No customer was messaged. No real account was paired for these checks. Live paired restart, sender/reply/delivery receipts and self-hosted endpoint readiness remain user validation. No paid compute was provisioned. This release ships a Linux x86_64 executable; other architectures require the documented Rust build. Terminal colors/fonts and mouse-reporting behavior vary across terminal emulators. The 80×24 layout and small-screen guard are exercised through a PTY, not every emulator.
