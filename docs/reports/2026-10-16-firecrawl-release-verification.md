# Firecrawl release verification

Date: 2026-10-16. Version: 0.1.15. Repository: aansh-afk/bismyth-lead-tui.

## Scope and method

Copied the previously validated TUI source into a fresh clone of the standalone repository, based on master at 3004d78. The homepage checkout and its unrelated changes are excluded. Runtime source, data, examples and scripts match the tested local build byte for byte. This release also publishes the account-login work that remained local after public v0.1.12.

Updated the default installer and README links to v0.1.15, added source-control exclusions for private runtime data, and included the public Firecrawl verification report and Baileys v1 contract. Refreshed the handoff manifest after documentation updates.

## Measured pre-publication results

- Fresh npm ci: 4 packages installed; 0 vulnerabilities reported by npm.
- TypeScript build passed.
- Fresh Firecrawl/contact/WhatsApp tests: 77 passed, 0 failed, 0 skipped; 2.271 seconds.
- Existing full verification: 267 main-suite checks and 3 browser-batch checks passed; 600 local fixture submissions and 100 preview forms. See the dated 2026-10-15 report for methods and limits.
- Baileys contract validator: 193 checks passed; 11 routes, 17 schemas; no network calls or live service tested.
- Installer shell syntax and git whitespace checks passed.
- Package: 35 files, 106380 bytes. All six new runtime modules present; tests, source maps and credential data excluded.
- Secret inspection: zero matches for the actual supplied private Firecrawl key in the candidate source/docs or archive. No credentials were copied from the user's app data.
- Package SHA-256: `aa2c24e9ce15a4aaacd22d1e465007d0d7b508f9c510d179344537cda6b897ac`. README and installer changes explain why this differs from the earlier local-only archive.

## Limitations

The publication checks do not establish real portal enquiries or WhatsApp delivery. Earlier bounded Firecrawl reads succeeded but both sampled public pages exposed no seller contacts. WhatsApp requires an externally deployed and paired compatible Baileys router. The key remains private on the local laptop; it is not included in the release.
