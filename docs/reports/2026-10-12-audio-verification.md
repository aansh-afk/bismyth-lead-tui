# Audio verification fallback and blocked-portal discovery

Date: 2026-10-12. Package: `tools/lead-tui` version 0.1.5.

## Implemented behavior

An offered reCAPTCHA audio challenge now uses the existing Playwright session, an independently written FFmpeg/Python helper and Google HTTPS speech recognition. ChatGPT remains the image/contact decision route. No upstream CAPTCHA solver source or second browser runtime was added.

The app checks visible audio inputs even when the audio button or source element is hidden, validates the observed Google/reCAPTCHA payload URL, validates transcription text and rejects an audio source refreshed during recognition or typing. Each cycle allows at most two audio answers, four image decisions and 120 seconds; same-page rechecks allow two cycles. A token still requires independent portal gate clearance. Stop cancels download and transcription, including child process groups on Linux.

The user's “Try again later” screenshot shows a provider block with no audio challenge offered. That state is detected without requiring an image panel and makes no solver call. During discovery, the blocked portal returns any partial listings immediately with a saved reason. The runner keeps its queue and proceeds to other selected portals. This routes discovery around a blocked portal; it does not clear the provider's block or grant access to protected operations.

`doctor` reports audio readiness. `doctor-fix` prepares a private app-storage Python environment pinned to `SpeechRecognition==3.17.0`, repairing supported Linux system prerequisites when necessary. Existing explicit Python overrides are preserved, and damaged private environments never trigger global pip installation.

## Method and environment

- Linux Mint 22.1, Node 20.19.5, Python 3.12.3, installed FFmpeg/Chrome and Playwright Core 1.64.0.
- Full automated suite uses local HTTP and Chromium fixtures, injected solvers and isolated storage. No real enquiry was submitted.
- Native helper tests use actual FFmpeg conversion and Python processes, with a stub recognizer rather than external recognition. They validate mono 16-bit 16 kHz WAV conversion, URL/size/deadline bounds, cancellation, process termination and missing-interpreter guidance.
- Provider-block fixtures reproduce the user's screenshot state. Offered-audio fixtures separately exercise provider acceptance, portal clearance, wrong answers, refreshed sources and same-page retry.
- Real external recognition used the SpeechRecognition project's [public English sample](https://github.com/Uberi/speech_recognition/blob/master/examples/english.wav). This public sample contains no user contact data. The helper's [Google backend API](https://github.com/Uberi/speech_recognition/blob/master/speech_recognition/recognizers/google.py) was inspected before implementation.
- An independent agent reviewed cancellation, helper packaging, private setup, retries, source freshness and partial queues.

## Results

Final `npm test`: **85 passed, 0 failed, 0 skipped**, **47.689 seconds**. TypeScript compilation passed.

Both real pseudo-terminal scenarios passed: guided setup/review/history/export and animated runs, Enter/Ctrl+R, pause/resume, browser handoffs, stopping and terminal/session cleanup.

The direct Python helper and the production Node helper both transcribed the real public sample through Google as **“1 2 3.”** The Node path processed a **22,587-byte MP3 input in 1,785 ms**, including real conversion and external recognition. Its challenge download was supplied from the local public-sample fixture; this was not a live CAPTCHA payload download or portal acceptance test. These are single observations rather than a throughput benchmark.

Actual `doctor-fix` in an initially empty temporary data directory created the private environment and installed the pinned package, then reported Chrome, saved ChatGPT login and **Audio: ready (Google speech recognition)**. Existing system prerequisites were already installed, so no real sudo/system-package repair was exercised; six mocked tests verify those repair paths and environment preservation.

The final tarball contains **26 entries**, including `scripts/transcribe-audio.py`, and is **64,796 bytes**. SHA-256: `7633178ec588b82ff33838ba38af5f747e4fd0ba6e3003a5caa6995dab3ff8e8`.

Installed that tarball into a clean temporary npm prefix with install scripts disabled. Its package metadata reported version 0.1.5, the Python helper and blocked-discovery runtime were present, and the installed `doctor` command found Chrome, the saved ChatGPT login and the prepared private audio environment. `git diff --check` passed.

Published source commit `a83ea5a` and [release v0.1.5](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.5). GitHub's asset digest matched the local SHA-256. The tagged public installer installed version 0.1.5 into another clean prefix; its installed doctor command again reported Chrome, ChatGPT login and ready audio support against the prepared isolated data directory.

## Failures found and corrected

- A combined selector originally selected a hidden audio button before a visible answer field. Filtering visible matches in the shared iframe helper fixed offered-audio detection.
- Parallel screenshots of 16 tiles exceeded short per-screenshot deadlines. Sequential, bounded captures fixed the 4×4 regression while retaining stale-image checks.
- Added a second source check after typing so an input-triggered audio refresh cannot submit stale words.
- Active transcription no longer performs synchronous prerequisite probes that could freeze terminal input; those checks remain in the noninteractive doctor commands. Missing interpreters produce asynchronous setup guidance.
- TypeScript fixture response bodies required an ArrayBuffer-backed byte copy. One discovery fixture needed matching HTTPS origins to avoid mixed-content blocking. Neither issue remained in the final run.

## Limits

Live 99acres CAPTCHA acceptance or provider-block clearance is not established. A provider block offers no audio to transcribe; the release preserves discovery progress and uses other selected portals. Audio recognition uses Google's shared-key route, separate from the user's ChatGPT subscription, and can be refused or unavailable. English audio was tested. Live Windows/macOS setup and system-package installation were not exercised.
