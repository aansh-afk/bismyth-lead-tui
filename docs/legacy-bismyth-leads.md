# Bismyth property enquiry TUI

Interactive terminal app for the Atlas sales funnel: share your selected callback details with real-estate sales teams, collect contacts revealed by the portals, and hand them to a separately hosted WhatsApp engine for qualification and manager referrals. **Playwright** handles website logins and property interests, **Firecrawl** reads public listing contact details, and a separately hosted **Baileys router** handles explicitly confirmed WhatsApp introductions. Codex uses your saved ChatGPT login to classify public contacts and choose observed browser controls.

## Install

Requirements: Node **20.19+**, Chrome/Chromium, and Codex CLI signed in with ChatGPT.

Install **v0.1.22** from the GitHub release:

```bash
npm install --global --prefix "$HOME/.local" https://github.com/aansh-afk/bismyth-lead-tui/releases/download/v0.1.22/bismyth-lead-tui-0.1.22.tgz
bismyth-leads --version
bismyth-leads
```

Or use the Linux/macOS installer, which installs under `~/.local` without sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/aansh-afk/bismyth-lead-tui/v0.1.22/install.sh | sh
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
bismyth-leads firecrawl-login
bismyth-leads collect-contacts RUN_ID 3
bismyth-leads export-contacts RUN_ID csv
```

## Try a small batch

Launch `bismyth-leads`. The first **Set up** page starts with **Website logins**. Select a website and press **Enter** to open it in Chrome. Enter passwords and OTPs directly into the website, then press **C** in the terminal to check that page. If needed, open the website's account menu so Logout or another signed-in control is visible. **K** skips a website; **N** saves the browser session and continues to your profile on the same Set up page. **L** reopens website logins.

Choose your **State / UT**, then choose the city from its India-only list. Enter your contact details and type **3** in Batch size. Press **F**, review the discovered properties, press **Enter**, and choose **Test forms**. Press **C** after browser handoffs, **K** to skip or **S** to stop. Test forms skips the final submit step; a logged-in site's contact entry point can itself initiate a portal action.

Website login setup covers 99acres, NoBroker, Housing, Square Yards, Magicbricks, OLX and Quikr. All seven have catalogued listing and contact flows. Authenticated forms vary; an adapter or a saved login does not prove a live submission will succeed. OLX uses a seller message, and sites with unknown controls stop for a browser step. Discovery on OLX and Quikr outside Mumbai asks you to confirm the actual city/intent filter rather than assuming it from a keyword URL. Saved observations say **Last verified**, not that a session is still authenticated. Login checks do not reload the page, submit credentials or invoke AI/CAPTCHA automation. Browser cookies stay in the private persistent profile; `accounts.json` stores only portal status and observation times. Skipping preserves existing browser data. **N** continues to the profile editor; discovery and URL imports use only selected listing websites whose latest TUI observation is **signed in**. Unconfirmed, signed-out, blocked, skipped and unchecked sites are excluded. If none qualify, the app returns to website logins without starting discovery. Saved website preferences are retained; activity and notices identify skipped sites. A recorded observation is not a guarantee that a session cannot expire later.

NoBroker checks recognise its signed-in profile icon even while the hover menu is closed. After signing in, select NoBroker in Set up and press **C**: a confirmed session shows **NoBroker login successful** in green. The check does not open the menu, click Sign Out or read account values.

Housing checks recognise its authenticated account popover and the plain **Log Out** control on `/user-profile/edit-profile`, together with profile navigation. Quikr checks recognise its authenticated **MyQuikr** account control and mobile logout control; hidden guest-menu logout markup does not count. Square Yards recognises its portfolio/sidebar logout and authenticated header; a passive reCAPTCHA badge is ignored, while visible verification challenges still block the check. If either remains unconfirmed, open the account menu or Housing profile page in the same Chrome tab and press **C**. A profile URL, cookie or bare avatar alone never establishes login.

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

To package this checkout for another machine, run `npm pack` and install the resulting `.tgz` with `npm install -g ./bismyth-lead-tui-0.1.22.tgz`. A local build does not publish a GitHub or npm release.

## Atlas lead-intake behavior

The original meeting assigns this CLI to distributing your callback number across 100–300 property lead forms. The separate WhatsApp engine handles replies, company qualification and manager referrals. Scraped numbers are an additional source, and are not counted as completed enquiries or qualified Atlas leads.

On Set up, enter `all` in Websites to include all seven portals; only selected portals with confirmed login observations are used. Existing preferences are retained unless you change them. Exact Contact controls are preferred over AI selection, and final submissions are scoped to the prepared form. A phone reveal or stale success message is not proof your details were sent.

NoBroker may send Contact into its viewing scheduler. Test forms selects the latest available date/time without clicking Confirm Booking. Send enquiries can create a real appointment once, then reads the matching contact-history card. **This uses NoBroker's registered account number; it does not prove the callback number entered in the TUI was shared. Use an account registered with the intended callback number.** Existing visits/rescheduling and uncertain booking outcomes are not automatically retried. A fresh **Visit Confirmation Pending** response records a submitted visit request awaiting NoBroker confirmation, collects any revealed contact details and advances without an OTP prompt or another booking click. Pending requests are counted separately from scheduled visits. Nearby-property recommendations and their Join Visit buttons are ignored. JSON retains the visit state; CSV appends actionKind and visitStatus after the existing six fields.

OLX seller messages contain an honest Atlas business introduction and the chosen callback phone/email. Test forms drafts only; Send enquiries clicks Send once and requires fresh outgoing-message evidence without a pending/failed status. This is portal UI confirmation, not proof a seller read or received the message. Contacts still need review and the existing Baileys send confirmation. This package does not deploy the external WhatsApp conversational agent or CRM.

## Guided workflow

1. **Set up:** connect website accounts first, then **N** continues to the profile. Choose a State / UT, then a city from that state’s India-only list, followed by buy/rent, name, email, phone, websites and batch size. Type to filter either list; Enter selects it. Enter edits the other fields; Ctrl+U clears them. Left/right cycle buy/rent and batch presets. **F** finds properties only on selected websites with confirmed logins, after the required profile details are complete. **L** or the Website logins field returns to account setup.
2. **Review queue:** discovery brings you here automatically. Scroll the properties, then press **Enter**. Choose **Test forms** to prepare forms without the final submit step, or **Send enquiries** to submit your supplied contact details. The dialog shows the queue size, location, name and phone before starting. E explains the Atlas funnel and exact portal-message draft. Send may create real NoBroker viewing appointments; bookings are counted separately from confirmed callback interests.
3. **Run & results:** follow progress and activity. If Chrome needs verification or extra fields, complete that browser step and press **C**. **K** skips it, **P** pauses/resumes, and **S** stops and saves progress. Results distinguish confirmed enquiries from tested forms and uncertain outcomes.
4. **Saved runs:** **W** opens the highlighted run’s WhatsApp recipient picker. Enter loads its property queue. **X** exports CSV; **J** exports JSON. **Q** saves progress and exits.
5. **Contacts:** **H** collects a bounded number of public listing pages with Firecrawl. **E** shows source evidence, **A** toggles approval, **Space** toggles a recipient, **B** selects all approved phone contacts, and **Z** clears the selection. **Enter** and **W** review only checked recipients. Choices are saved independently for each run and survive restart; old and newly copied runs start unchecked. New contacts remain unchecked. Selecting someone does not send a message. The review dialog defaults to **Preview only**; sending requires choosing **Send reviewed introductions** and pressing Enter. **C** checks the router sender; **U** reconciles saved operations and refreshes replies. **O** exports contact CSV; **Shift+O** exports contact JSON.

**1–5 / Tab** change sections. **A** on Set up reveals advanced settings, including URL import, browser path, delays, adapter overrides and your **WhatsApp business** name. **?** opens the keyboard guide. You can import a project URL file with **I**, then review it with Enter. Advanced settings are optional for property enquiries.

**Ctrl+R** finds properties from Set up or an empty queue. On another screen, an existing queue opens the test/send chooser. Saved confirmed logins work after restarting; you do not need to finish the website-login step again. Opening the chooser keeps you on the current page and starts no work. Before running, every website represented in the queue needs a confirmed login; missing logins are named with **L** to open website logins, and the queue is kept intact. **Enter** on Review queue opens that same chooser; press Enter again to start the selected mode. During a run, Enter resumes a pause or continues after you complete a browser prompt. A spinner and elapsed time show active discovery/form processing even when no new log arrives. Paused runs, browser handoffs, stopping and finished runs use static status labels, and the animation stops when work ends.

Use a terminal at least 70 columns by 22 rows. Wider terminals show a workflow sidebar; smaller supported terminals show section tabs. Undersized terminals ask you to resize while keeping progress.

Browser prompts wrap across several lines. Press **E** to read the complete current message; **↑/↓**, **Page Up/Down**, **Home/End** scroll it and **E/Esc** returns. Run controls remain available in that view. Messages longer than the footer explicitly offer Full message instead of silently truncating the reason or controls. The details view closes when that browser step changes or completes.

## Collect public contact details with Firecrawl

Save your Firecrawl key locally before starting the TUI:

```bash
bismyth-leads firecrawl-login
bismyth-leads
```

The key prompt is hidden and makes no network request. It saves the key in `credentials/firecrawl.key` under the app's data directory, with private file and directory permissions. `FIRECRAWL_API_KEY` can supply an environment override. Keys are kept out of saved run files, exports and Codex subprocesses. `doctor` reports whether a key is configured; that is not a live access check. `BISMYTH_FIRECRAWL_URL` optionally selects another compatible HTTPS Firecrawl API endpoint, or HTTP on localhost.

Start with a discovered, imported or saved property queue. Press **H**, use **↑/↓** to choose a page budget, then press **Enter** to start. The initial budget is at most ten pages; try three for a small check. **P** pauses between steps, **S** cancels remaining work, and progress is saved. Pages with an existing collected or no-contact result are skipped. The CLI accepts a budget of 1–300 pages:

```bash
bismyth-leads history
bismyth-leads collect-contacts RUN_ID 3
bismyth-leads export-contacts RUN_ID csv
bismyth-leads export-contacts RUN_ID json
```

Without a number, `collect-contacts` defaults to ten pages. Ctrl+C stops that CLI pass and preserves completed results. The CLI uses the same data-directory lock as the TUI, so close the TUI before running collection in another terminal.

Firecrawl requests public Markdown and links. Local parsing extracts complete Indian mobile numbers, email addresses and public WhatsApp links; Codex then classifies the existing candidates through your ChatGPT subscription. Each contact retains its source URL, quoted evidence and observation time. Numbers are normalized and deduplicated across listings while their source attributions are retained. Explicit owner, broker, developer, sales or agency evidence can approve a candidate; uncertain attribution remains **needs-review**. Review the evidence with **E** before using **A** to approve it manually. Email addresses remain exportable and are not WhatsApp recipients.

Firecrawl uses its own key and scrape allowance; Codex classification consumes your Codex account usage. The app does not request Firecrawl's AI JSON extraction. Public contact values and their evidence are supplied to Codex for classification. Hidden or masked numbers are not reconstructed, login pages and security challenges are reported, and a blocked page is not treated as a contact. Rate-limit, credit and credential failures stop the remaining provider requests without automatic retries.

After a confirmed portal interest or seller message, Playwright reads visibly revealed listing contacts. NoBroker also checks the matching property on its contacted-properties page and uses the official desktop phone-copy control. Only that property is read. Authenticated evidence is labelled separately from public Firecrawl evidence; it is not uploaded to Firecrawl or the public-contact classifier. Collected numbers can be portal relays and begin with WhatsApp availability unchecked. Contact collection failure preserves a confirmed submission. H remains an optional public-page pass, and evidence/approval is retained when sources merge.

## Connect the Baileys router and review WhatsApp introductions

This package supplies the router **client**, not a Baileys server. Your router developer must deploy the external contract-v1 service, create a sender session and complete its WhatsApp pairing. The TUI does not create, reset or pair sessions. Configure these three variables in the shell that launches the TUI:

| Variable | Value |
|---|---|
| `BISMYTH_WHATSAPP_ROUTER_URL` | Router HTTPS origin, or HTTP on localhost; no path or embedded credentials |
| `BISMYTH_WHATSAPP_ROUTER_API_KEY` | The router's local API credential |
| `BISMYTH_WHATSAPP_SESSION_ID` | The paired sender-session UUID supplied by the router |

For example, in Bash, replace the URL and session UUID with your developer's values and enter the key at the hidden prompt:

```bash
export BISMYTH_WHATSAPP_ROUTER_URL='https://router.example'
export BISMYTH_WHATSAPP_SESSION_ID='your-sender-session-uuid'
read -rsp 'Router API key: ' BISMYTH_WHATSAPP_ROUTER_API_KEY
printf '\n'
export BISMYTH_WHATSAPP_ROUTER_API_KEY
bismyth-leads
```

In **5 Contacts**, press **C** to check that the selected sender is connected and the router is ready. Your saved contact name and **Set up → A → WhatsApp business** supply the sender identity. The introduction asks whether the recipient is the right person, or can introduce you to the sales manager, agency owner or business head. It asks for a work number only if that person is happy to be contacted.

In **Saved runs**, press **W** to choose that run’s recipients, or open **5 Contacts** for the loaded run. Mark the people to include with **Space**; leave everyone else unchecked. **B** selects all approved phones and **Z** clears them. Press **Enter** or **W** to review the checked recipients. Enter never substitutes the highlighted unchecked person. Each run remembers its choices. Approval alone does not select a recipient, and revoking approval removes their selection. Read the exact message and sender/recipient list; **E** opens full message and source evidence. **Preview only — no message sent** is selected by default and checks number availability plus the router's dry-run response. To send, reopen review, select **Send reviewed introductions** with the arrow keys, and explicitly press **Enter**. **Esc** cancels. A public phone number or successful availability check does not establish who owns the WhatsApp account or permission to contact it.

The private `outreach.json` ledger saves the exact message and a unique request ID before transport. A sender/number/introduction is deduplicated across runs, including failed and uncertain attempts. Router acceptance is recorded separately from sent, delivered, read and replied states. If a response is lost, the app preserves the uncertain operation and does not resend it automatically. **U** looks up saved operations by their original IDs and fetches only outreach conversations for the current run's collected numbers; it sends no follow-up messages.

Incoming replies, explicit phone numbers supplied in replies and contact-card referrals can be read in **E**. Referral numbers are recorded as evidence and are not automatically contacted. Clear STOP/unsubscribe replies mark an opt-out. Older personal messages, unrelated chats and group/broadcast activity are not imported as outreach replies. Live router connectivity, successful pairing, provider acceptance and real message delivery must be checked against your deployed service; local fixtures do not establish those outcomes.

**O / Shift+O** export contacts as CSV / JSON, including their evidence and listing associations. These are separate from **X / J**, which export property enquiry results. Contact exports do not include router credentials or the private message ledger.

`outreach.lock` excludes other ledger writers while a send or refresh is running. Normal completion and cancellation release it. A forcibly killed process can leave the lock behind; the error identifies its path. Confirm that the earlier process has stopped before removing that file, then use **U** to reconcile saved operations.

## Import URLs and adjust adapters

Discovery reads the selected search page once, then uses public Housing GraphQL or NoBroker REST listing responses when its active city, intent and filters can be validated. Housing requests only listing URLs, titles, IDs and pagination metadata; NoBroker preserves the page's observed search filters and reads at most two anonymous pages. Requests have time and response-size bounds, use no account credentials, and are cancelled when a run stops.

Saved activity reports API properties, request counts and decoded JSON bytes. If an API refuses access or changes its response, already-found properties are retained and discovery uses the existing browser path. Small queues that already fit the initial page need no extra API request. 99acres continues to use browser discovery. API listing reads do not send enquiries; Playwright still handles contact forms and the explicit Send enquiries choice.

Live verification on this machine returned 51 unique NoBroker listings in two anonymous API requests. Housing's GraphQL query worked through the browser and curl, but the app's direct Node request timed out; its 15-second fallback was verified. Other cities and rental searches have fixture coverage only where specified in the verification reports.

Set **Import URL file** to a text file (one URL per line, `#` comments allowed) or a JSON string array. Press **i** for direct project URLs; press **d** to discover listings from imported search-result URLs. Imported links must belong to supported selected portals with confirmed logins; URLs from other sites are excluded.

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

The TUI shows the connection state at the top. Codex chooses among observed contact controls; Playwright clicks the selected control and fills the supplied contact data. Firecrawl contact classification chooses existing extracted IDs and must cite verbatim page evidence; it cannot add contact values. Site discovery, number parsing and submission confirmation remain deterministic. OTPs and required extra fields remain browser handoffs.

Each model invocation uses `codex exec`, saved CLI auth, structured JSON output, `forced_login_method="chatgpt"`, ignored user provider configuration, a read-only sandbox and a private temporary working directory. The child environment excludes `OPENAI_API_KEY`, `CODEX_API_KEY`, API gateway overrides, `FIRECRAWL_API_KEY` and the WhatsApp router credential. Authentication failure, subscription limits or model errors retain the browser handoff or public contacts needing review; there is no OpenAI API-key or Laya fallback. The app never reads or copies your auth tokens.

Contact-control requests contain control labels and the task, without the contact values. CAPTCHA requests attach only the challenge panel screenshot plus the grid dimensions and already-selected tile IDs. Temporary screenshots have private permissions and are removed when the request finishes. Contact entry-point choices are bounded to the IDs observed on the page. Final enquiry submit controls are excluded from model selection. Actual decisions consume your Codex account's usage allowance; access is subject to that account's limits.

Image CAPTCHA decisions explicitly select **GPT-6 Luna with low reasoning** (`--model gpt-6-luna -c 'model_reasoning_effort="low"'`). Image requests allow 180 seconds for a response; contact-control decisions keep the CLI's default model and 90-second deadline. Your account must have access to Luna; a model-access error retains the browser handoff. [GPT-6 Luna supports image input and low reasoning, but no audio input](https://developers.openai.com/api/docs/models/gpt-6-luna). Automatic audio solving is disabled.

Verified on this machine: Codex CLI 0.160.1 reports ChatGPT login, and `check-subscription` completed a real contact-control decision. This establishes the configured subscription authentication route; it does not establish unlimited quota or your exact plan tier.

Sources: [official authentication guidance](https://learn.chatgpt.com/docs/auth), [official non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode).

## Saved data and counting

Data lives at `~/.local/share/bismyth-lead-tui`, or `BISMYTH_TUI_DATA`. Configuration, runs, collected contact evidence, exports, the private Firecrawl credential, `outreach.json` and the dedicated Chrome profile stay outside the repository. Run and ledger files are written atomically with private permissions. One TUI session or contact-collection CLI job can use a data directory at a time. `BISMYTH_BROWSER_PATH` overrides automatic Chrome detection.

- **Prepared:** form fields filled in preview mode; no final submit click.
- **Submitted:** a new visible portal confirmation was observed.
- **Uncertain:** a submit action or interruption occurred without verified confirmation. These are not automatically retried.
- **Failed:** preparation encountered an error before submission.
- **Skipped:** manually skipped or blocked by contact/project deduplication.

Submitted and uncertain enquiries are deduplicated across saved submit-mode runs using the normalized phone/email and canonical project URL. Known www/apex portal aliases normalize consistently, including saved rows with historical IDs. Different listing paths for the same development are not guaranteed to deduplicate. Generic confirmation wording may need a site-specific selector override. Login-dependent entry buttons may themselves initiate portal actions; preview only guarantees that this engine does not call its final submit step.

The meeting target is 100–300 projects per run. Discovery can return fewer projects, and queued/prepared projects are not successful enquiries. Phone verification, site limits, changing forms and unavailable search results can prevent reaching the target. Real portal enquiry submissions have not been performed during development.

## Website verification

Square Yards, Magicbricks, OLX and Quikr use a read-only browser handoff for security checks. Complete verification in Chrome, then recheck; these four flows do not run automatic challenge actions. The legacy automatic behavior described below applies to 99acres, NoBroker and Housing only.

During discovery, contact preparation and post-submit verification, the app attempts reCAPTCHA checkboxes and visible 3×3/4×4 image grids using **GPT-6 Luna with low reasoning** through your saved ChatGPT subscription. Playwright applies its validated tile selections and Verify decisions. Each automatic cycle has a ten-minute budget and at most twelve image decisions; each image-loading wait allows thirty seconds and each Luna request allows three minutes. These are upper limits, not compulsory delays. Enter permits a second cycle on the same page; subsequent automatic cycles are bounded. CAPTCHA Verify and a verification page's enabled Proceed button may be clicked; this is separate from submitting a property enquiry.

The app never clicks an offered audio button, downloads audio or invokes speech recognition during normal runs. If audio mode is already open, it uses an observed enabled image-mode button once to return to images. Without that button it reports the missing image mode. Missing grids, model errors or uncertain decisions retain an image-only handoff. Hidden legacy tiles are excluded from numbering. Changed instructions or tile images discard the stale answer within the attempt bounds. Activity reports loading diagnostics, **GPT-6 Luna · low reasoning**, request budgets, answer arrival and actual tile clicks. Quit and relaunch after upgrading so an already running process loads the new solver.

Image capture uses one viewport crop of the complete instruction and all image tiles, without scrolling around individual elements. An overflowing dialog footer does not reject an otherwise visible grid. The app separately checks a tile or Verify control immediately before clicking it. Clipped instructions/tiles, page obstruction, nested frames and canvas formats each report a specific handoff reason. Hover decorations do not trigger repeated image requests. Browser clicks are spaced by at least one second, with 1.5 seconds for images to settle after a selection batch. Selecting every tile, repeating already selected tiles, three consecutive stale answers or exceeding eighteen tile clicks ends the automatic cycle. An unchanged challenge receives only one Verify click. **P** holds subsequent CAPTCHA actions; **S** cancels pending model calls and clicks and closes the browser. A click already dispatched can finish before Pause takes effect.

These guards limit incorrect or repetitive actions; they do not establish that Luna recognizes every street scene correctly. The prompt requires the exact requested object and asks for a handoff when uncertain, but a model can still return an incorrect valid tile list. Image freshness uses instructions, image URLs and crop metadata; pixel changes behind an unchanged image URL are not independently detected. Live provider acceptance remains unverified.

Image detection supports Google's actual `#rc-imageselect` dialog ID and the earlier `.rc-imageselect` class variant. Verification fixtures include ID-only dialogs with actual 3×3/4×4 table-cell tiles; a visible image grid is not rejected merely because its container has no class.

When Chrome completes verification, the app rechecks the current page and follows its enabled **Proceed** button. It supports portal callbacks without a response textarea and waits up to eight seconds for delayed enablement/navigation. A disappearing provider iframe is rechecked against the portal state. Frame disappearance or a checkbox tick alone never counts as clearance.

CAPTCHA-specific browser handoffs observe clearance once per second and continue on the current page; **C** also rechecks immediately. OTPs, terms and other form handoffs still use C after you complete them. **K** skips the current property/site and opens the next one, which may trigger another verification. The app keeps an already selected search-results page instead of navigating to the same URL again. If Proceed fails to clear the gate, automatic retries stop there; C can explicitly recheck. A manually cleared gate can continue even after the image-attempt limit.

A checkbox tick or a transcription never counts as portal acceptance. On a dedicated verification page, the portal must clear its gate before discovery continues. Changed images/audio, invalid decisions and exhausted attempts produce a visible reason. Provider “Try again later” blocks are detected before solver calls: discovery preserves found properties and continues to other selected websites. The app does not repeatedly request an audio challenge when the provider has blocked it. OTPs and consent remain manual. Live 99acres provider-block clearance is not established.

The previous audio helper remains packaged for compatibility and explicit injected-helper tests; it is unused by normal app runs. Its optional prerequisites are Python 3.9+, FFmpeg and `SpeechRecognition==3.17.0`, and existing `doctor-fix` setup remains available. Doctor clearly reports automatic audio as disabled. The supplied repository's source was not copied.

The WhatsApp client sends the reviewed introduction and records replies and explicitly supplied referral numbers. Autonomous conversations, automatic referral outreach, calling, private 99acres inbox extraction and CRM integration remain outside this package. A separately deployed compatible Baileys router is required for actual WhatsApp operations.

## Verify

```bash
npm test
```

To additionally test the real subscription against a synthetic challenge (consumes account usage):

```bash
npm run build
BISMYTH_TEST_SUBSCRIPTION_VISION=1 node --test dist/tests/captcha.test.js
```

Tests cover validation, persistence, duplicate prevention, cancellation, pause/resume, conservative recovery, subscription environment isolation, guided UI rendering, API pagination and timeout handling, and real headless Chromium against local property-form and API-discovery fixtures. Contact tests use offline Firecrawl/Codex/router fixtures to exercise public evidence validation, dry-run defaults, durable send identities, uncertain outcomes, receipts, replies, opt-outs and contact exports. They do not establish live scraping access or real WhatsApp delivery. Use a supported Node runtime for the test command. Verification reports are in `docs/reports/`.

The application code is MIT licensed. The bundled India location data is separately available under the Open Database License; see `data/README.md` and `data/LICENSE-ODbL.txt`.
