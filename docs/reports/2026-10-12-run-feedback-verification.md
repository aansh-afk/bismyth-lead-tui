# Terminal run feedback and shortcuts

Date: 2026-10-12. Package: `tools/lead-tui` version 0.1.4.

## Result

Active property discovery and form processing now show a ten-frame Braille spinner, an operation label and elapsed time in the common header and results screen. The terminal redraws every 120 ms during work, even when a browser or API await produces no log event. Paused, browser-handoff, stopping, queue-ready and finished states use static labels. Animation ticks only render; they do not write storage or add events. Timers are cleared when activity stops and during shutdown.

The user identified Review queue (screen 2) as the place where Enter appeared unresponsive. That screen now prominently shows its action: Enter or Ctrl+R opens the Test forms / Send enquiries chooser, and a second Enter starts the selected mode. Ctrl+R from Setup finds properties. Empty queues provide a next-action message. Enter also resumes a paused run or continues a browser handoff; if both are present, the first Enter resumes and the next continues the prompt.

## Setup and method

- Node 20.19.5, TypeScript 6.0.2, Playwright Core 1.64.0 and installed Google Chrome on Linux.
- Pure renderer checks compare successive frames and state labels, including the common header on another section and undersized terminals.
- The full package suite uses local HTTP/browser fixtures and isolated temporary storage. No real property enquiry was sent.
- `scripts/terminal_smoke.py` launches the real terminal app and real key parser in a pseudo-terminal. Its added scenario replaces the child browser methods with delayed fake discovery and preparation before loading the launcher. It cannot open Chrome, call a model or submit an enquiry. The existing subscription-status check reads the local Codex login state.
- A second agent implemented and exercised the PTY scenario, and reviewed the final animation/shortcut behavior independently.

## Observations

`npm test`: **59 passed, 0 failed, 0 skipped**, elapsed **43.871 seconds**. TypeScript build passed.

The renderer test proves different active spinner frames and correct Finding properties, Testing forms and Sending enquiries labels. Paused, Needs you in Chrome, Stopping, Queue ready, Run finished and Run stopped output remains identical when the frame input changes.

Both terminal smoke scenarios passed. The active scenario observed multiple frames during delayed discovery and form preparation without new driver events, an elapsed-time display, Review queue → Enter opening the chooser, Ctrl+R discovery/review shortcuts, pause freezing the animation, Enter resuming, static browser prompts and Enter continuing them. It additionally checks the paused-browser-prompt priority. After completion and a final-output drain, the terminal produced **zero output over 450 ms**. Stopping and quitting restored the cursor and alternate screen and removed the session lock.

The initial targeted core run had 22 passes and one failure because an existing assertion expected the old literal footer `F Find properties`. That assertion was updated for the new `F / Ctrl+R Find properties` text. The final full suite passed.

Final review also found and corrected an empty-queue instruction that advertised F outside Setup; it now names the working Ctrl+R shortcut. The final build passed after this text correction.

`npm pack` built a 24-entry, 59,049-byte tarball with compiled runtime modules and no new dependencies. SHA-256: `15709078f5d2db92b2ba785d2f2451cb01fbaa933bfe2ce6c4e147ad10f6d0df`.

Installed the final tarball into an isolated temporary npm prefix with install scripts disabled. The package reported version 0.1.4, its compiled modules contained the spinner and corrected queue shortcut, `--help` passed, and `doctor` found Chrome plus the saved ChatGPT login using empty test storage.

## Limits

The animation proves that the terminal is refreshing during an active operation; it does not prove that a remote portal is making progress or that an enquiry succeeded. The elapsed display measures time since the current phase started, including pauses and browser waits, and freezes while the status is static. The user's exact installed terminal session was not available to reproduce its Enter symptom; the source app's real Review queue Enter path is verified by the PTY fixture. Live portal behavior was not retested for this UI change.
