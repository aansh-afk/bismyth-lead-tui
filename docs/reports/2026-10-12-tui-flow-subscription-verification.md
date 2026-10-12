# TUI redesign and ChatGPT subscription verification

## Outcome

Redesigned the native terminal app with a workflow sidebar, restrained cyan accents, focused field selection, edit dialogs, a responsive compact layout and contextual commands. The flow is now Set up → Find properties → Review queue → Test forms or Send enquiries → Run and results. Advanced settings are hidden from everyday setup. Discovery returns to the review screen automatically, and starting a run requires an explicit choice showing the queue and contact profile.

The active AI browser path uses Codex CLI and saved ChatGPT login. Laya is no longer called by the browser driver. Playwright performs browser actions and fills supplied contact values; Codex selects contact entry points among observed controls. The engine still detects confirmation from portal evidence rather than trusting the model. Setup now requires an India-only State / UT selection before it offers the matching city list, preventing free-text location typos and invalid state/city combinations.

## Setup and method

- Node 20.19.5, Playwright Core 1.64.0, TypeScript 6.0.2 and installed Chrome.
- Codex CLI 0.160.1. `codex login status` reports `Logged in using ChatGPT`; no credential file was read or copied.
- One real `check-subscription` inference using the production helper. Offered a Contact owner control and a View gallery control, with a bounded output schema. The returned choice was Contact owner.
- Child invocations ignore user provider config, enforce `forced_login_method="chatgpt"`, exclude API-key/provider endpoint environment variables, use read-only sandboxing and private ephemeral directories, and validate returned IDs. Failed subscription authentication/inference does not switch to an API key or Laya.
- Automated browser tests use an injected deterministic decision helper and a localhost fixture; they do not consume subscription allowance or submit real portal enquiries.
- Native pseudo-terminal testing at 100×24, resized to 80×30. Captured actual ANSI screen output and rendered it with a terminal emulator for visual inspection. Screenshots contain temporary fixture data, not the user's contact profile.

## Results

| Check | Result |
|---|---|
| Build | Passed |
| Automated tests | 20 passed, 0 failed; measured suite duration 6.85 seconds |
| India location picker | 36 states/UTs and 4,198 cities packaged; valid Maharashtra/Mumbai and Pune selections accepted, cross-state and misspelled combinations rejected |
| Native terminal smoke | Subscription status, edit/save, advanced toggle, project import, review dialog/cancel, history/load, CSV export, resize, help and clean exit passed |
| Live ChatGPT login check | Connected |
| Real subscription decision | Passed: Contact owner |
| API key environment isolation | Passed |
| Guided UI checks | Next actions, review choices, advanced-setting separation, compact layout and resize fallback passed |
| Browser regression | Delayed contact form, required terms, fresh vs stale confirmation and run handoff passed |
| Dependency audit | 0 vulnerabilities |
| Whitespace validation | Passed |
| 100-item browser fixture | 100 forms prepared in preview mode; zero final submissions |
| 200-item browser fixture | 200 confirmed submissions; submitted contact values verified; saved-run resume produced zero duplicates |
| 300-item browser fixture | 300/300 confirmed submissions; submitted contact values verified; saved-run resume produced zero duplicates; 236,791 ms processing time |

Visual evidence: [setup](2026-10-12-tui-setup.png), [review dialog](2026-10-12-tui-review.png).

One repeated pseudo-terminal run sent the next command at Node's Escape-versus-Alt parsing deadline and failed to cancel the dialog in time. Increased the harness's wait after a bare Escape from 0.5 to 0.9 seconds; the final full terminal check passed. The app uses Node's standard key parser.

## Scope and limits

The successful live probe establishes use of the saved ChatGPT authentication route and an actual response. It does not identify the user's exact subscription tier, establish unlimited allowance or measure live portal submission success. Codex decisions consume the account's applicable usage allowance. No external enquiry submissions were performed during this redesign.

Model input contains control labels and task text, not the contact values. The model is restricted to offered contact entry-point IDs; it cannot choose final submit actions or declare enquiries confirmed. Website limits, changing forms, OTPs and required extra fields can still require browser handoff. CAPTCHA challenges require completion by a person in the provider's own browser flow; the TUI detects them and provides Continue or Skip. It does not bypass or solve them.

Official references: [Codex authentication](https://learn.chatgpt.com/docs/auth), [non-interactive execution and structured output](https://learn.chatgpt.com/docs/non-interactive-mode).
