# Firecrawl contacts and WhatsApp client verification

Date: 2026-10-15. Package: `bismyth-lead-tui@0.1.15`.

## Observed result

The native terminal app can collect public contact candidates with Firecrawl, retain exact listing evidence, classify those candidates through the saved ChatGPT login, and prepare reviewed introductions through the Baileys router client. Playwright enquiry submission remains independent. The package is installed at `/home/aansh/.local/bin/bismyth-leads`; this task did not publish a GitHub or npm release.

The supplied Firecrawl credential was saved outside the repository with directory mode 0700 and file mode 0600. Tests and package inspection found no credential leakage. The saved profile, account metadata and 15 existing runs were checked against a pre-install SHA-256 manifest: all 17 files remained byte-for-byte unchanged after installation, without printing their contents.

## Methods and measured checks

| Check | Result |
|---|---|
| `npm test` | 267 passed; 0 failed, cancelled or skipped; 131.409 seconds |
| UI regression subset | 62 passed; 0 failed; 22.264 seconds |
| `npm run test:batches` | 3 passed; 0 failed; 386.802 seconds; 100 preview forms and 600 confirmed local fixture submissions |
| Source PTY smoke | Passed at 120x30: startup, saved queue, Contacts, default preview, full draft/source, budget dialog, cancel and zero-exit quit |
| Installed PTY smoke | Passed: installed executable, saved queue, Contacts rendering, zero-exit quit |
| Real ChatGPT classification | Saved ChatGPT login verified; 1 expected synthetic candidate selected; 9212 ms |
| `npm pack` | 35 files; 106457 bytes; new runtime modules present |
| Archive credential inspection | 0 occurrences of the actual supplied key; tests, source maps and credential files excluded |
| Installed `--version` | `0.1.15` |
| Installed `doctor` | Chrome detected; ChatGPT login connected; Firecrawl key configured; WhatsApp router settings absent |

The real loopback router flow completed in 1.172 seconds. The 100-form browser check completed in 124.781 seconds including its 100-form preview; the 200-form check completed in 98.438 seconds. The 300-form check completed in 161.910 seconds. All three verified exact supplied values and zero duplicate submissions on resume.

The main suite includes public number/email parsing; strict source and redirect validation; bounded requests; blocked/login pages; provider auth/credit/rate failures; exact AI evidence; pause, stop and startup cancellation; contact exports; subscription environment isolation; and sender-scoped receipts/replies.

A real loopback HTTP integration test exercises TerminalApp → Runner → OutreachService → WhatsAppRouter → Store. Its server inspects the durable pending operation at the HTTP dispatch boundary. Preview makes zero fixture transport sends and creates no ledger entry. One explicitly requested fixture send remains deduplicated across retries; reconciliation, delivered receipts, replies, referral extraction, cursor reuse and disconnected-session messages are verified. No real WhatsApp service or recipient was used.

The filesystem outreach lock prevents two Store instances from dispatching duplicate introductions or overwriting the ledger. Normal failure/cancellation releases the lock. A forcibly killed process can leave a lock that requires checking the earlier process has stopped before removing the file; pending operations then require reconciliation, never automatic resending.

## Live Firecrawl observations

Two public listing URLs were selected from saved NoBroker/Housing queues. Only the public URL and scrape options were sent: Markdown plus links, main content, automatic proxy, bounded timeout. No browser cookies, supplied contact profile, password or OTP was uploaded. Exactly two Firecrawl API requests were made; no retries, crawls, JSON AI extraction or property enquiry submissions were made.

| Portal | API HTTP | Requests | Capture result | Contacts | Elapsed ms |
|---|---:|---:|---|---:|---:|
| nobroker | 200 | 1 | not-found | 0 | 4281 |
| housing | 200 | 1 | not-found | 0 | 13101 |

Both source pages passed metadata/source validation but exposed no unmasked public Indian mobile numbers or seller email addresses. The result was `not-found`, rather than a successful lead claim. The live pages therefore did not invoke AI classification. A separate synthetic text-only candidate was classified using the actual saved ChatGPT subscription; no real lead details were needed for that check. Actual Firecrawl credit consumption was not queried, so the request count is not a measured billing total.

## Failures found and corrected

- TypeScript rejected a test assertion narrowed before an asynchronous controller action. The test now waits for the controller action to complete.
- The initial feature run passed 74/75 checks. It exposed an email parser rejecting a valid address followed by a sentence-ending period; the parser and punctuation regressions were corrected.
- The first complete regression run passed 263/266 checks. Three existing UI checks exposed missing Ctrl+R shortcut labels. Both queue/results footers were restored; the final complete run passed 267/267, including the added HTTP integration test.
- Early ad-hoc PTY checks had harness timing/ANSI/line-wrap assumptions. The harness now waits for screen text, removes terminal control sequences and allows readline's Escape timeout. The completed source and installed checks are reported above/below.
- Code review found same-origin redirect misattribution, long-line evidence truncation, cancellation during browser closure and a missing service-level filesystem lock. These were fixed before final packaging and covered by regression tests.

## Artifact and data checks

Archive: `tools/lead-tui/releases/bismyth-lead-tui-0.1.15.tgz`.

SHA-256: `0e1d5a191afbf88b814745c4cb3c45eff3297d07751962d94f716aa6a63a6e0d`.

The npm archive includes the Firecrawl, contacts, contact-AI, WhatsApp, outreach and credential helper modules. It contains no saved runtime data, real API key, test files or source maps. Runtime keys and saved data stay outside the installation. The public installer remains on the older 0.1.12 release; use this local archive for the new features.

## Limits and conclusions

Observed: local build, unit/browser fixtures, loopback router flow, terminal controls, real Firecrawl access, actual ChatGPT text classification and local installation work. Sampled portal contact coverage was zero. Hidden/masked numbers remain unavailable; Firecrawl does not create account-inbox access or additional portal enquiry adapters.

Unverified: deployed Baileys authentication/pairing, actual WhatsApp availability/send/delivery/replies, live property enquiry acceptance, other listing coverage and other Firecrawl account limits. No live enquiry or WhatsApp message was sent in this task. A successful fixture or API response does not establish those outcomes.

Next integration step: the router developer deploys contract v1, pairs the selected sender and supplies its URL, API key and sender-session UUID. The TUI client and reviewed sending flow are ready for that service. Contact review defaults to Preview only; live sending requires the separate explicit Send choice.
