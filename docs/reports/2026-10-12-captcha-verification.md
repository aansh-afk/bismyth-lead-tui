# CAPTCHA attempts verification

Date: 2026-10-12. Package: `tools/lead-tui`, version 0.1.2.

## Implementation

Playwright attempts reCAPTCHA checkboxes and visible 3×3/4×4 image grids during discovery, pagination, contact preparation and post-submit verification. The existing ChatGPT-authenticated Codex subprocess accepts a private screenshot of the challenge panel and returns bounded tile IDs. No additional service, API key or dependency was added.

Selections are validated, existing selections are passed into subsequent decisions, and screenshots are checked again before clicking. A selected tile that refreshes during an earlier click is not clicked using the stale decision. The attempt allows four image decisions and a two-minute budget; stopping the run aborts the inference. Failure is retained for manual handoff rather than repeatedly consuming subscription usage. After manual widget completion, the recheck can click an enabled verification-page Proceed control without another image request.

The provider response and the portal gate determine continuation. Checkbox appearance and model output cannot establish portal acceptance. Enquiry confirmation remains a separate check; a successful CAPTCHA without an enquiry confirmation stays uncertain.

## Setup and method

- Node 20.19.5, Playwright Core 1.64.0, installed Chrome, Codex CLI 0.160.1.
- Local HTTP fixtures use a different iframe origin (`localhost` inside `127.0.0.1`) to exercise cross-origin browser interaction. Invented contact data is used only against the fixture.
- Normal tests inject deterministic image decisions. Separate opt-in tests use real saved ChatGPT login, with no API-key fallback, against a synthetic coloured-square challenge.
- The subscription test performs the complete challenge flow, including a second decision to verify after selections and the fixture portal's return to results.
- Terminal smoke uses isolated temporary storage and real pseudo-terminal keypresses.

## Observed results

| Check | Result |
|---|---|
| TypeScript build | Passed |
| Final combined automated suite | 38 passed, 0 failed; 46.38 seconds total |
| CAPTCHA tests with real subscription inference | 17 passed, 0 failed; 62.54 seconds total |
| Real subscription synthetic challenge | Completed end to end; 20.83 seconds for the live-inference case |
| Checkbox-only and late iframe flows | Passed without invoking image inference |
| Checked checkbox without a token | Remained pending |
| Accepted widget with disabled Proceed | Remained pending |
| 3×3 / 4×4 grids | Valid selections accepted and portal returned to results |
| Invalid tile IDs / duplicates / actions | Rejected |
| Changed challenge / refreshed individual tile | Rejected before stale clicks |
| Retry bound, cancellation, inference failure | Passed; manual fallback reason retained |
| Contact preparation | CAPTCHA solved before supplied contact fields were filled |
| Manual recheck | No repeated image decision; accepted widget allowed portal continuation |
| Terminal smoke | Passed setup, location picker, review, export, resize, help and clean exit |

## Limits and conclusion

These tests establish implementation behaviour and a real ChatGPT-authenticated vision round trip against a synthetic challenge. They do not establish a live Google reCAPTCHA success rate or a live portal enquiry success rate. The collaborative browser's existing 99acres tab was still at its security-check page on inspection; no claim is made that the new helper cleared that session. No external enquiry was submitted in this verification.

Audio challenges, hCaptcha, Cloudflare challenges, unsupported grids, server-side refusals, OTP and mandatory consent remain handoffs. Dynamic image grids may exceed the four-decision budget or trigger conservative stale-image rejection. Subscription quotas and provider/model failures can also cause handoff. Real portal acceptance remains to be measured.
