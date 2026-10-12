# Bismyth property enquiry TUI

Interactive terminal app for property enquiry batches. Playwright drives a persistent Chrome session; Codex uses your saved ChatGPT login for AI contact-control decisions.

## Install

Requirements: Node **20.19+**, Chrome/Chromium, and Codex CLI signed in with ChatGPT.

Install the ready-built release:

```bash
npm install -g https://github.com/aansh-afk/bismyth-lead-tui/releases/download/v0.1.1/bismyth-lead-tui-0.1.1.tgz
bismyth-leads
```

Or use the Linux/macOS installer, which installs under `~/.local` without sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/aansh-afk/bismyth-lead-tui/v0.1.1/install.sh | sh
```

If `~/.local/bin` is not on your PATH, the installer prints the full command to run. `BISMYTH_INSTALL_PREFIX` changes the installation prefix. `BISMYTH_TUI_VERSION` selects a release version.

On a new machine, set up the subscription login:

```bash
npm install -g @openai/codex
codex login                         # choose Sign in with ChatGPT
bismyth-leads doctor
```

Each machine uses its own Codex login. The installer does not copy credentials, install a browser or change your shell.

`bismyth-leads doctor-fix` creates local app storage and, when missing, installs Codex and Chromium on supported Linux package-manager hosts. It asks for `sudo` only for Chromium installation. ChatGPT login, CAPTCHA and OTP verification remain interactive steps; the command prints the exact next action when one is needed.

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

Use a terminal at least 70 columns by 22 rows. Wider terminals show a workflow sidebar; smaller supported terminals show section tabs. Undersized terminals ask you to resize while keeping progress.

## Import URLs and adjust adapters

Set **Import URL file** to a text file (one URL per line, `#` comments allowed) or a JSON string array. Press **i** for direct project URLs; press **d** to discover listings from imported search-result URLs. Imported links must belong to the supported portals and selected sites.

The examples directory contains inspected public Pune project URLs and an adapter override file. Paths are relative to the directory from which you launch the app.

Built-in portal adapters use observed listing URL patterns and common contact fields. Set **Adapter overrides** to a JSON file when a portal changes. Per-site options include `openSelector`, `submitSelector`, `successSelector`, `nextSelector`, `openLabels`, `submitLabels`, `projectPattern`, `successPattern`, and `fields`. Only configure a success selector that identifies an actual enquiry confirmation. Each extra field name maps to an array of input selectors; set its value in **Extra form values**, for example `{"budget":"10000000"}`. The app does not invent answers to portal-specific questions or check required consent boxes.

## Your ChatGPT subscription

The browser's AI decisions now use **Codex CLI with your saved ChatGPT login**. The active browser engine no longer calls Laya. Legacy Laya configuration is retained only for saved-file compatibility.

```bash
codex login                         # choose Sign in with ChatGPT
bismyth-leads doctor                 # checks Chrome and ChatGPT login
bismyth-leads doctor-fix             # installs Codex/Chromium where possible
bismyth-leads check-subscription     # makes one real, small decision
```

The TUI shows the connection state at the top. Codex chooses among observed contact controls; Playwright clicks the selected control and fills the supplied contact data. Site discovery, contact values and submission confirmation remain deterministic. OTPs and required extra fields remain browser handoffs.

Each model invocation uses `codex exec`, saved CLI auth, structured JSON output, `forced_login_method="chatgpt"`, ignored user provider configuration, a read-only sandbox and a private temporary working directory. The child environment excludes `OPENAI_API_KEY`, `CODEX_API_KEY` and API gateway overrides. Authentication failure, subscription limits or model errors produce a visible failure; there is no API-key or Laya fallback. The app never reads or copies your auth tokens.

The decision request contains control labels and the task, without the contact values. Contact entry-point choices are bounded to the IDs observed on the page. Final submit controls are excluded from model selection. Actual decisions consume your Codex account's usage allowance; access is subject to that account's limits.

Verified on this machine: Codex CLI 0.160.1 reports ChatGPT login, and `check-subscription` completed a real contact-control decision. This establishes the configured subscription authentication route; it does not establish unlimited quota or your exact plan tier.

Sources: [official authentication guidance](https://learn.chatgpt.com/docs/auth), [official non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode).

## Saved data and counting

Data lives at `~/.local/share/bismyth-lead-tui`, or `BISMYTH_TUI_DATA`. Configuration, runs, exports and the dedicated Chrome profile stay outside the repository. Run files are written atomically with private permissions. One TUI session can use a data directory at a time. `BISMYTH_BROWSER_PATH` overrides automatic Chrome detection.

- **Prepared:** form fields filled in preview mode; no final submit click.
- **Submitted:** a new visible portal confirmation was observed.
- **Uncertain:** a submit action or interruption occurred without verified confirmation. These are not automatically retried.
- **Failed:** preparation encountered an error before submission.
- **Skipped:** manually skipped or blocked by contact/project deduplication.

Submitted and uncertain enquiries are deduplicated across saved submit-mode runs using the normalized phone/email and canonical project URL. Different listing URLs for the same development are not guaranteed to deduplicate. Generic confirmation wording may need a site-specific selector override. Login-dependent entry buttons may themselves initiate portal actions; preview only guarantees that this engine does not call its final submit step.

The meeting target is 100–300 projects per run. Discovery can return fewer projects, and queued/prepared projects are not successful enquiries. Phone verification, site limits, changing forms and unavailable search results can prevent reaching the target. CAPTCHAs require a person to complete the provider’s own verification in Chrome; the TUI detects the challenge and pauses with a clear Continue/Skip choice. Real portal enquiry submissions have not been performed during development.

WhatsApp automation, AI conversations, manager extraction, calling and CRM integration remain outside this package.

## Verify

```bash
npm test
```

Tests cover validation, persistence, duplicate prevention, cancellation, pause/resume, conservative recovery, subscription environment isolation, guided UI rendering and real headless Chromium against a local property-form fixture. Use a supported Node runtime for the test command. Verification reports are in `docs/reports/`.

The application code is MIT licensed. The bundled India location data is separately available under the Open Database License; see `data/README.md` and `data/LICENSE-ODbL.txt`.
