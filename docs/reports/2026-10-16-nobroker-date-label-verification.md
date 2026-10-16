# NoBroker date-label correction verification

Date: 2026-10-16. Package: 0.1.20.

## Problem and root cause

The user showed an open Schedule your FREE visit modal with available dates, while the TUI reported no readable available visit date. The application already uses Playwright Core 1.64.0, not Puppeteer. The issue was in the shared NoBroker date parser.

The current official [ScheduleVisitNew frontend asset](https://assets.nobroker.in/nb-new/ScheduleVisitNew/ScheduleVisitNew.ca3dbad4b912dc29ef8f.chunk.js), read through the collaborative preview without account credentials or website clicks, returned HTTP 200. It creates adjacent day-number and weekday/Today spans with no separating text node. The DOM text is therefore `16Today` or `21Wed`. The parser required whitespace before the suffix, so it rejected those controls. The earlier fixtures used literal spaced labels and did not reproduce production markup.

## Change and verification method

The shared anchored day matcher now accepts zero or more whitespace characters before the existing weekday/Today allowlist. Month parsing, calendar-date validation, visibility/disabled checks, latest-slot selection, final confirmation and duplicate guards are unchanged. Switching browser engines would not correct this text-parsing requirement.

Both scheduler-helper and PortalBrowser/Runner fixtures now use adjacent spans and nested month markers matching the official markup. A regression includes an independent Join Visit card, available and disabled October dates, and the Today label. It requires the latest enabled date and evening time while asserting zero Join Visit, outside Confirm Booking and in-calendar Confirm Booking clicks during preparation. Existing tests cover one explicit final loopback POST, rescheduling, stale confirmations, manual selection changes and repeated preparation.

All test appointments, enquiry submissions and contact operations use synthetic local fixtures. No real appointment, live enquiry, live login/OTP or CAPTCHA action, or WhatsApp message was performed for this correction.

## Measured results

The new regression was run against the old parser first: it failed at readiness as expected (one failed, four unrelated tests skipped; 2.405 seconds). The full post-fix `npm test` run passed **360/360**, with zero failures/cancellations/skips, in **150.161 seconds**. This includes the corrected helper cases and the PortalBrowser/Runner Preview/Submit integration. The separate workspace TypeScript build, installer shell syntax and git whitespace checks passed. A read-only helper review confirmed that full-string date validation, disabled controls and explicit final submission remain enforced.

## Limits

The root cause is supported by the user screenshot, current public frontend markup and a reproduced failing test. This does not establish successful authenticated scheduling on the user's live account. Their existing run and Chrome window must be retained; a running process needs a restart to load installed changes.

## Package and installation

The release archive contains 39 files and 123542 bytes. Its compiled JavaScript matches both built checkouts. Tests, maps, private configuration, account observations and browser-profile directories are excluded. The actual local Firecrawl key and user-provided example contact occur zero times in package contents. SHA-256: `94655684c32a077206781c9e372eef57bd51ec09227d484b1e09aa5ed948f0b3`. Source commit: `228712f`. [Release v0.1.20](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.20) and its annotated tag were pushed. The anonymous public archive download matched the SHA-256 above. The pinned public installer passed shell syntax validation and installed successfully under `/home/aansh/.local`; `bismyth-leads --version` reports `0.1.20`. All 39 installed package files match the verified public archive byte for byte.

A fresh snapshot immediately before installation compared 21 saved files (configuration, account observations, run JSON/exports and Firecrawl credential), including permissions: zero changes and zero additions. Existing website selections and contact details were retained. No running user TUI or Chrome process was terminated or reloaded.

The installed command also passed a real 120×40 pseudo-terminal check using a temporary synthetic data directory: Ctrl+R opened the chooser without returning to Setup, Escape cancelled and allowed reopening, Q exited with code zero, saved fixture JSON was unchanged and no browser started. Quit and reopen an existing TUI to load the installed correction.
