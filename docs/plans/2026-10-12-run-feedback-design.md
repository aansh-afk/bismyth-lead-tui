# Run feedback and keyboard shortcuts

The user requested visible animation during terminal runs and a usable shortcut because Enter appeared to do nothing. Retain the existing four-section terminal workflow and explicit test/send choice.

Use a small Braille spinner, operation label and elapsed time. A timer redraws only during active discovery or form processing; it adds no log events or storage writes. This provides visible liveness during long awaits. A progress bar alone would remain static during those waits, while a made-up percentage would misrepresent work.

Paused, browser-handoff, stopping and finished states use static labels. Put the current status in the common header as well as the run screen, including the undersized-terminal message. Clean up the timer on every idle transition and shutdown.

Preserve Enter for editing setup fields and confirming selectors. Ctrl+R is the common run shortcut: find properties on Setup or when no queue exists, otherwise open the test/send review. Enter continues a browser handoff, resumes a paused run, and opens the review from an idle results screen. The footer names each next action; empty queues show a useful instruction.

Implementation: update the existing terminal renderer and app event handler without dependencies. Verify state labels through pure renderer checks and animation/shortcut behavior through an isolated pseudo-terminal with a delayed fake browser driver. Build, run the package checks and publish the updated installable release using the established isolated release checkout.
