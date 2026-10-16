# NoBroker acknowledgement verification

Date: 2026-10-16. Package: 0.1.21.

## Observed problem

The user supplied two post-submission screenshots while the TUI requested an OTP or remaining form steps. The first popup says Visit Confirmation Pending, gives a concrete viewing date/time and promises an executive call. The second says Your visit is scheduled and includes a large adjacent panel of nearby properties with other dates and Join Visit controls. Neither screenshot shows an OTP input.

The current official [ScheduleVisitNew frontend asset](https://assets.nobroker.in/nb-new/ScheduleVisitNew/ScheduleVisitNew.ca3dbad4b912dc29ef8f.chunk.js) was read through the collaborative preview with credentials omitted and returned HTTP 200. Its primary acknowledgement panel is separate from the recommendations. It explicitly distinguishes pending requests from scheduled visits. The previous detector accepted only the scheduled wording and bounded the entire modal text, making the detector unsuitable for these variants. The OTP instruction was a generic unconfirmed-submission fallback, not proof an OTP had been detected.

## Changes and method

Recognition uses the visible primary confirmation region, exact pending/scheduled headings, concrete date/time and known supporting copy for pending. Stable outcome/date/time keys exclude phone, help-text and recommendation changes. Hidden, duplicate, incomplete and ambiguous acknowledgement panels do not prove a submission. Generic thanks and nearby recommendations do not establish success.

The driver exposes optional structured confirmation while retaining the legacy boolean method for existing drivers. The runner uses one observation, saves an acknowledged pending request as submitted with contactAction.visitStatus=pending, captures available contacts and advances. It does not equate an acknowledged request with a scheduled appointment or submit again. Pending and scheduled outcomes appear separately in the TUI, summary and exports. CSV retains its existing first six fields and appends actionKind and visitStatus. Existing saved runs remain readable and are not retroactively reclassified.

Read-only review found two related manual-handoff gaps: a late scheduler response could retain the initial interest-form classification, and that path did not add its duplicate key before the next queue row. Both paths now use the observed visit outcome and block equivalent same-run hostname aliases. Tests cover persistence before contact capture, next-listing processing, saved-run/new-run deduplication, manual handoff, stale evidence, wide recommendations and supported terminal sizes.

All booking/enquiry/contact operations in tests use local synthetic fixtures. No real appointment, live enquiry, live OTP/security interaction, Firecrawl request or WhatsApp message was performed for this correction. User screenshots provide observations of their live state; they do not establish a newly verified live run of this package.

## Results

Both new screenshot regressions were run against the preserved v0.1.20 detector before the fix: **two failed as expected**, six unrelated helper tests were skipped, and the run took **3.462 seconds**. The patched compiled detector was restored before the full configured regression list began. The full configured regression suite passed **367/367**, with zero failures/cancellations/skips, in **143.278 seconds**. Both TypeScript builds, installer shell syntax and git whitespace checks passed. Package and installed-command checks passed as recorded below.

## Limits

Unknown portal responses remain uncertain and are not automatically retried. Actual OTP and security checks remain operator steps. No stored uncertain result is changed merely because the package was updated. An already running TUI requires a restart to load this correction; its process and Chrome session must not be terminated by the installer.

## Package

The archive contains 39 files and 125659 bytes. Compiled JavaScript matches both built checkouts. Tests, source maps, private configuration, account observations and browser-profile directories are excluded. The actual saved Firecrawl key and user-provided example contact occur zero times in package contents. SHA-256: `df69787b0f2bbf477ef692f934c3008920c34055d1a855e9b3249cbe55d14008`. Source commit: `bddea5c`. [Release v0.1.21](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.21) and its annotated tag were pushed successfully. The archive was downloaded anonymously from the public release and matched the SHA-256 above. The pinned public installer passed shell syntax validation and installed under `/home/aansh/.local`; the command on PATH resolves to `/home/aansh/.local/bin/bismyth-leads` and reports `0.1.21`. All 39 installed files match the verified archive byte for byte.

A fresh snapshot immediately before installation compared 23 saved files, including configuration, account observations, root/run JSON and CSV data, and the Firecrawl credential. Hashes and permissions were unchanged, with zero added files. Existing website selections and contact details were retained. No user TUI or Chrome process was terminated or reloaded.

The installed command passed a real 120×40 pseudo-terminal check with synthetic temporary data: Ctrl+R opened the chooser without returning to Setup, Escape cancelled and allowed reopening, Q exited with code zero, fixture JSON was unchanged and no browser started. Quit and reopen an existing TUI to load the installed code. Existing uncertain entries are preserved and are not rebooked automatically.
