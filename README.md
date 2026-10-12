# Bismyth property enquiry TUI

Interactive terminal app for property enquiry batches. Playwright drives a persistent Chrome session; Codex uses your saved ChatGPT login for AI contact-control decisions.

## Install

Requirements: Node **20.19+**, Chrome/Chromium, and Codex CLI signed in with ChatGPT.

Install the ready-built release:

```bash
npm install -g https://github.com/aansh-afk/bismyth-lead-tui/releases/download/v0.1.7/bismyth-lead-tui-0.1.7.tgz
bismyth-leads
```

Or use the Linux/macOS installer, which installs under `~/.local` without sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/aansh-afk/bismyth-lead-tui/v0.1.7/install.sh | sh
```

If `~/.local/bin` is not on your PATH, the installer prints the full command to run. `BISMYTH_INSTALL_PREFIX` changes the installation prefix. `BISMYTH_TUI_VERSION` selects a release version.

On a new machine, set up the subscription login:

```bash
npm install -g @openai/codex
codex login                         # choose Sign in with ChatGPT
bismyth-leads doctor
```

Each machine uses its own Codex login. The installer does not copy credentials, install a browser or change your shell.

`bismyth-leads doctor-fix` creates local app storage and, when missing, installs Codex, Chromium and audio prerequisites on supported Linux package-manager hosts. It uses `sudo` for system packages and creates a private Python environment for audio transcription. ChatGPT login and OTP verification remain interactive steps; the command prints the exact next action when one is needed.

```bash
bismyth-leads --help
bismyth-leads doctor-fix
bismyth-leads history
bismyth-leads export RUN_ID csv
bismyth-leads check-subscription
```

## Try a small batch

Launch `bismyth-leads`, choose your **State / UT**, then choose the city from its India-only list. Enter your contact details and type **3** in Batch size. Press **F**, review the discovered properties, press **Enter**, and choose **Test forms**. Press **C** after browser handoffs, **K** to skip or **S** to stop. Test forms skips the final submit step; a logged-in site's contact entry point can itself initiate a portal action.

For development tests against a local fixture, clone the repository and run `npm ci && npm test`. These do not send real portal enquiries.

## Develop from source

```bash
git clone https://github.com/aansh-afk/bismyth-lead-tui.git
cd bismyth-lead-tui
npm ci
npm run build
npm start
```

`npm start` can select a compatible Node version already installed under `~/.nvm/versions/node` if your shell's Node is older. It does not install Node or change your shell.

## Guided workflow

1. **Set up:** choose a State / UT, then a city from that state’s India-only list, followed by buy/rent, name, email, phone, websites and batch size. Type to filter either list; Enter selects it. Enter edits the other fields; Ctrl+U clears them. Left/right cycle buy/rent and batch presets. **F** finds properties after all required details are complete.
2. **Review queue:** discovery brings you here automatically. Scroll the properties, then press **Enter**. Choose **Test forms** to prepare forms without the final submit step, or **Send enquiries** to submit your supplied contact details. The dialog shows the queue size, location, name and phone before starting.
3. **Run & results:** follow progress and activity. If Chrome needs verification or extra fields, complete that browser step and press **C**. **K** skips it, **P** pauses/resumes, and **S** stops and saves progress. Results distinguish confirmed enquiries from tested forms and uncertain outcomes.
4. **Saved runs:** Enter loads a previous run. **X** exports CSV; **J** exports JSON. **Q** saves progress and exits.

**1–4 / Tab** change sections. **A** on Set up reveals advanced settings, including URL import, browser path, delays and adapter overrides. **?** opens the keyboard guide. You can import a project URL file with **I**, then review it with Enter. Advanced settings are optional for the normal workflow.

**Ctrl+R** finds properties from Set up, or opens the test/send chooser for the current queue on another screen. **Enter** on Review queue opens that same chooser; press Enter again to start the selected mode. During a run, Enter resumes a pause or continues after you complete a browser prompt. A spinner and elapsed time show active discovery/form processing even when no new log arrives. Paused runs, browser handoffs, stopping and finished runs use static status labels, and the animation stops when work ends.

Use a terminal at least 70 columns by 22 rows. Wider terminals show a workflow sidebar; smaller supported terminals show section tabs. Undersized terminals ask you to resize while keeping progress.

## Import URLs and adjust adapters

Discovery reads the selected search page once, then uses public Housing GraphQL or NoBroker REST listing responses when its active city, intent and filters can be validated. Housing requests only listing URLs, titles, IDs and pagination metadata; NoBroker preserves the page's observed search filters and reads at most two anonymous pages. Requests have time and response-size bounds, use no account credentials, and are cancelled when a run stops.

Saved activity reports API properties, request counts and decoded JSON bytes. If an API refuses access or changes its response, already-found properties are retained and discovery uses the existing browser path. Small queues that already fit the initial page need no extra API request. 99acres continues to use browser discovery. API listing reads do not send enquiries; Playwright still handles contact forms and the explicit Send enquiries choice.

Live verification on this machine returned 51 unique NoBroker listings in two anonymous API requests. Housing's GraphQL query worked through the browser and curl, but the app's direct Node request timed out; its 15-second fallback was verified. Other cities and rental searches have fixture coverage only where specified in the verification reports.

Set **Import URL file** to a text file (one URL per line, `#` comments allowed) or a JSON string array. Press **i** for direct project URLs; press **d** to discover listings from imported search-result URLs. Imported links must belong to the supported portals and selected sites.

The examples directory contains inspected public Pune project URLs and an adapter override file. Paths are relative to the directory from which you launch the app.

Built-in portal adapters use observed listing URL patterns and common contact fields. Set **Adapter overrides** to a JSON file when a portal changes. Per-site options include `openSelector`, `submitSelector`, `successSelector`, `nextSelector`, `openLabels`, `submitLabels`, `projectPattern`, `successPattern`, and `fields`. Only configure a success selector that identifies an actual enquiry confirmation. Each extra field name maps to an array of input selectors; set its value in **Extra form values**, for example `{"budget":"10000000"}`. The app does not invent answers to portal-specific questions or check required consent boxes.

## Your ChatGPT subscription

The browser's AI decisions now use **Codex CLI with your saved ChatGPT login**. The active browser engine no longer calls Laya. Legacy Laya configuration is retained only for saved-file compatibility.

```bash
codex login                         # choose Sign in with ChatGPT
bismyth-leads doctor                 # checks Chrome and ChatGPT login
bismyth-leads doctor-fix             # repairs Codex, Chrome and audio setup
bismyth-leads check-subscription     # makes one real, small decision
```

The TUI shows the connection state at the top. Codex chooses among observed contact controls; Playwright clicks the selected control and fills the supplied contact data. Site discovery, contact values and submission confirmation remain deterministic. OTPs and required extra fields remain browser handoffs.

Each model invocation uses `codex exec`, saved CLI auth, structured JSON output, `forced_login_method="chatgpt"`, ignored user provider configuration, a read-only sandbox and a private temporary working directory. The child environment excludes `OPENAI_API_KEY`, `CODEX_API_KEY` and API gateway overrides. Authentication failure, subscription limits or model errors produce a visible failure; there is no API-key or Laya fallback. The app never reads or copies your auth tokens.

Contact-control requests contain control labels and the task, without the contact values. CAPTCHA requests attach only the challenge panel screenshot plus the grid dimensions and already-selected tile IDs. Temporary screenshots have private permissions and are removed when the request finishes. Contact entry-point choices are bounded to the IDs observed on the page. Final enquiry submit controls are excluded from model selection. Actual decisions consume your Codex account's usage allowance; access is subject to that account's limits.

Image CAPTCHA decisions explicitly select **GPT-6 Luna with low reasoning** (`--model gpt-6-luna -c 'model_reasoning_effort="low"'`). Contact-control decisions keep the CLI's default model. Your account must have access to Luna; a model-access error retains the browser handoff. [GPT-6 Luna supports image input and low reasoning, but no audio input](https://developers.openai.com/api/docs/models/gpt-6-luna), so offered audio challenges continue through the separate Google speech-recognition helper.

Verified on this machine: Codex CLI 0.160.1 reports ChatGPT login, and `check-subscription` completed a real contact-control decision. This establishes the configured subscription authentication route; it does not establish unlimited quota or your exact plan tier.

Sources: [official authentication guidance](https://learn.chatgpt.com/docs/auth), [official non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode).

## Saved data and counting

Data lives at `~/.local/share/bismyth-lead-tui`, or `BISMYTH_TUI_DATA`. Configuration, runs, exports and the dedicated Chrome profile stay outside the repository. Run files are written atomically with private permissions. One TUI session can use a data directory at a time. `BISMYTH_BROWSER_PATH` overrides automatic Chrome detection.

- **Prepared:** form fields filled in preview mode; no final submit click.
- **Submitted:** a new visible portal confirmation was observed.
- **Uncertain:** a submit action or interruption occurred without verified confirmation. These are not automatically retried.
- **Failed:** preparation encountered an error before submission.
- **Skipped:** manually skipped or blocked by contact/project deduplication.

Submitted and uncertain enquiries are deduplicated across saved submit-mode runs using the normalized phone/email and canonical project URL. Known www/apex portal aliases normalize consistently, including saved rows with historical IDs. Different listing paths for the same development are not guaranteed to deduplicate. Generic confirmation wording may need a site-specific selector override. Login-dependent entry buttons may themselves initiate portal actions; preview only guarantees that this engine does not call its final submit step.

The meeting target is 100–300 projects per run. Discovery can return fewer projects, and queued/prepared projects are not successful enquiries. Phone verification, site limits, changing forms and unavailable search results can prevent reaching the target. Real portal enquiry submissions have not been performed during development.

## Automatic CAPTCHA attempts

During discovery, contact preparation and post-submit verification, the app attempts reCAPTCHA checkboxes and visible 3×3/4×4 image grids using **GPT-6 Luna with low reasoning** through your saved ChatGPT subscription. When an audio challenge is already visible or the provider offers an audio button, it can transcribe that challenge using Google speech recognition. Each automatic cycle has a two-minute budget, at most four image decisions and two audio answers. Enter permits a second cycle on the same page for late-loading or transient challenges; subsequent automatic cycles are bounded. CAPTCHA Verify and a verification page's enabled Proceed button may be clicked; this is separate from submitting a property enquiry.

Image grids take priority over an offered audio button. The app waits up to eight seconds for all 9/16 tiles and their images to load before falling back to offered audio; an already open audio answer field is handled immediately. An image-solver failure can also use audio fallback. Activity explicitly reports **GPT-6 Luna · low reasoning**, tile selection, image Verify and any switch to audio. Quit and relaunch after upgrading so an already running process loads the new solver.

A checkbox tick or a transcription never counts as portal acceptance. On a dedicated verification page, the portal must clear its gate before discovery continues. Changed images/audio, invalid decisions and exhausted attempts produce a visible reason. Provider “Try again later” blocks are detected before solver calls: discovery preserves found properties and continues to other selected websites. The app does not repeatedly request an audio challenge when the provider has blocked it. OTPs and consent remain manual. Live 99acres provider-block clearance is not established.

Audio support requires Python 3.9+, FFmpeg and `SpeechRecognition==3.17.0`. Run `bismyth-leads doctor-fix` to prepare `audio-venv` inside app storage. `BISMYTH_AUDIO_PYTHON` can select an existing interpreter; doctor-fix preserves that override. Audio downloads are limited to observed Google/reCAPTCHA HTTPS payload URLs and bounded sizes. Conversion and transcription have deadlines, are cancelled when the run stops, and retain no audio files. Only challenge audio is sent to Google; contact details are not sent. This audio service is separate from your ChatGPT subscription. Its shared-key recognition route may be refused or unavailable; it does not guarantee successful CAPTCHA verification. The supplied repository's source was not copied.

WhatsApp automation, AI conversations, manager extraction, calling and CRM integration remain outside this package.

## Verify

```bash
npm test
```

To additionally test the real subscription against a synthetic challenge (consumes account usage):

```bash
npm run build
BISMYTH_TEST_SUBSCRIPTION_VISION=1 node --test dist/tests/captcha.test.js
```

Tests cover validation, persistence, duplicate prevention, cancellation, pause/resume, conservative recovery, subscription environment isolation, guided UI rendering, API pagination and timeout handling, and real headless Chromium against local property-form and API-discovery fixtures. Use a supported Node runtime for the test command. Verification reports are in `docs/reports/`.

The application code is MIT licensed. The bundled India location data is separately available under the Open Database License; see `data/README.md` and `data/LICENSE-ODbL.txt`.
