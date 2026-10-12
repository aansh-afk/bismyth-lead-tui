# Detect Google's actual image-dialog ID

The user showed version 0.1.8 timing out with “no visible image panel” and confirmed that Chrome displays an image grid. Inspection of Google's exact browser-loaded runtime found an ID-only `rc-imageselect` dialog. The detector searched only for a class of that name. Previous synthetic fixtures used the same incorrect class assumption.

Use `#rc-imageselect, .rc-imageselect` consistently in image readiness, CAPTCHA detection and the checkbox guard. Retain the existing image-only mode, timing, subscription auth, tile validation and acceptance checks.

Replace default fixtures with ID-only dialogs and add table-based 3×3/4×4 regressions matching Google's tile structure, plus a separate legacy class compatibility case. Run an isolated old-runtime reproduction to show the ID-only cases fail with the user's missing-panel message. Validate the corrected engine and real Luna through the ID-only fixture, then publish version 0.1.9 and update the local installation.
