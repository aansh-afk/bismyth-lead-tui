# Build version label — 2026-10-17

## Change

The sidebar shows the compiled frontend version immediately beneath the Oracle Leads logo, aligned with L E A D S. Compact terminals show the same version on the right side of the status footer. Both labels derive from Cargo's package version, rather than a separate UI string. This patch is v0.4.1.

## Method and observed results

Built the native frontend with Rust/Cargo using the locked dependency graph. Strict clippy and formatting checks passed. The release build completed in 29.67 seconds.

A temporary pexpect/pyte check launched the real native frontend against an isolated synthetic service. At 128×40 it verified that v0.4.1 appears exactly one row beneath L E A D S, at the same column. After resizing to 80×24 it verified the version on the status footer. Passed in 2.21 seconds. The rendered excerpt is in version-terminal-screens.txt. No customer contacts or live WhatsApp account were used.

## Limits and conclusion

This is a display and release-version change. Service logic, sending rules and quiet hours are unchanged. No service test suite was rerun for this UI-only patch. Existing running frontends keep their compiled version until reopened; the label identifies that running frontend build.
