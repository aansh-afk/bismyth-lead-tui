# Oracle Leads

Run command: **`bismyth-leads`**. Product: **Oracle Leads**.

A local terminal workspace for Atlas outreach and customer relationships. Oracle Leads combines the Bismyth Leads contact workflow with Oracle's model-provider integration. It is an outreach product; the `oracle` command no longer launches a coding assistant.

## Run

```sh
bismyth-leads
# Oracle Leads is the product name; bismyth-leads remains the command.
```

Choose **Codex subscription** or **Self-hosted model** at startup. Contacts, conversations, memories, meetings and run history are shared across providers. Every launch begins paused. No GPU is provisioned and no provider fallback happens automatically.

```sh
bismyth-leads --provider codex
bismyth-leads --data-dir /path/to/separate-workspace
```

Requirements: Python 3.11+ with curses (Linux/macOS), Node.js 24+, and the dependencies in `package-lock.json`. The launcher finds an installed Node 24 in the usual NVM location or on PATH. On another machine:

```sh
cd /path/to/bismyth-lead-tui
ONNXRUNTIME_NODE_INSTALL=skip npm ci
npm run build:tui # Rust toolchain required when building from source
npm start
```

The release includes a native Linux x86_64 frontend. Other Linux/macOS architectures can build it with `npm run build:tui`. The interface uses **Ratatui + Crossterm**, also used by OpenAI Codex CLI; it is an independent outreach interface backed by the existing Codex CLI integration.

Click navigation, contact rows, action buttons, menu options, confirmations and text fields. Use the mouse wheel to scroll lists/conversations; click inside a field to place the caret. Bracketed paste and arrow-key editing are supported.

The primary installed command is `~/.local/bin/bismyth-leads`. Optional local Oracle aliases open the same outreach app. Use a terminal at least **80×24** for normal operation. A WhatsApp QR can require about **80×46**; its page reports the actual minimum dimensions. Shrink the terminal font or enlarge the window to scan it.

## Five pages

Use **1–5** to switch pages, **Space** to start/pause the worker, **R** to refresh, and **Q** to quit. Escape returns from a view. Single-line forms save with Enter; multi-line editors save with **Ctrl+S**, **Ctrl+G**, or the Save button. **Ctrl+U** clears a field.

### 1 — Dashboard

Real counts for contacts, interest, meeting requests, booked local meetings, clients, sends, replies and automatic actions underway. Shows recent activity, follow-ups due and sampled active agent time. **C** focuses the persistent inline operator chat; type a question such as “What happened in the previous run?” or “What did we promise this client?”. **H** opens previous runs; **M** opens meeting records.

Dashboard chat is read-only: it can explain the records but cannot send messages, create bookings or alter contacts. It retrieves a bounded set of relevant relationships, source messages and memories instead of uploading the entire database. It identifies when additional records are needed.

### 2 — WhatsApp

**C** connects the local Baileys service and displays its QR. Scan it yourself from WhatsApp → Linked devices → Link a device. The connected phone identity comes from the paired account. Use **Disconnect** or **Unlink** with explicit confirmation. The inbox lists only contacts currently active for that sender.

If scanning fails, choose **Enter phone number** (or press **F** on page 2), also available as **Enter phone number instead** inside the QR dialog. Enter your WhatsApp number with its country code. Oracle shows an eight-character pairing code. On your phone, open **WhatsApp → Linked devices → Link a device → Link with phone number instead**, then enter that code. Keep the phone online; if WhatsApp rejects a code, request a fresh one or choose **Use QR**.

If WhatsApp expires the session, a relogin prompt appears on any page. Choose **Get a pairing code for the same number** or **Scan QR with the same number**. **Later** dismisses it; **Relogin** remains on the WhatsApp toolbar. Expired credentials are replaced without deleting contacts, memories or permissions. A different number is rejected during recovery; use explicit Unlink to switch accounts. After relinking, press **Start Agent** to resume. Quiet hours still apply. Temporary network loss reconnects automatically.

An entered number is only a pairing target. The account becomes the verified sender after WhatsApp confirms linking. An already-linked account must be explicitly unlinked before pairing another number. Pairing never activates contacts or starts automation. Codes are visible only in the private local pairing session and are cleared on success/disconnect; they are excluded from relationship backups and activity logs.

The service stores Baileys credentials/Signal keys in the private local SQLite database rather than the example multi-file auth store. It requests no full historical chat sync. Direct messages require an exact scoped number; WhatsApp LIDs require a legitimate explicit phone mapping. Groups, broadcasts, historical replay and unscoped contacts do not reach the relationship agent.

Account changes deactivate the old contact scope. A manual reply from the phone pauses automatic replies for that relationship. Temporary connection loss waits and reconnects the saved sender automatically; a running autonomous agent continues after recovery. Explicit disconnect, logout, account replacement and process restart still pause sending.

### 3 — Contacts

Your searchable directory combines saved Bismyth/Oracle leads with the contact metadata your linked WhatsApp account shares. Existing saved Bismyth phone contacts are loaded once into the default workspace; original saved runs remain unchanged. Separate `--data-dir` workspaces use explicit Import / Older runs. Later saved runs can be loaded with **Older runs**.

Click the visible search field or press **/** / **Ctrl+F**. Results and the selected preview update as you type; search names, company, role, notes, stage, or a phone number with normal spaces/brackets. **All**, **Enabled**, **WhatsApp** and **Saved** filters show the relevant source/access list. **Clear** restores the full list. Search text consumes normal typing, including page numbers and shortcut letters. Enter, Down, Tab or Escape leaves the search field.

Click a contact or use arrow keys to preview them. **Home/End** and **Page Up/Down** navigate long lists. The preview remains available at 80×24; **Overview**, **Chat** and **Memory** tabs show relationship context, saved conversation and permanent notes. The selected contact stays selected when data refreshes or their name moves in the list. **Actions** opens editing, meeting and consent controls; **Write** and **Activity** remain visible. Activity shows timing, outcomes and exceptions; it is not an approval step.

WhatsApp metadata is synchronized separately from message history, after linked-device keys are ready. **Refresh WhatsApp** checks available contact-state updates. WhatsApp may not provide the entire phone address book or a usable phone identity for every contact; import a CSV/JSON file for missing numbers. Groups, broadcasts, the sender’s own entry and unresolved LIDs are excluded. Showing a person does not monitor their messages. Every newly listed contact starts inactive without consent; existing opt-outs and operator names remain authoritative. Explicit deletion suppresses automatic WhatsApp rediscovery.

**I** imports CSV/JSON, **L** loads older runs, and **E** exports contacts. Existing files and Oracle model settings remain in place.

CSV columns:

```csv
name,phone,company,role,source,notes,stage
```

Use international phone numbers beginning with `+` and a country code. JSON accepts an array or `{ "contacts": [...] }`. Numbers are deduplicated. Imported stages are preserved (including contacted, interested, not_interested, nurture and low_intent); unknown stages are rejected rather than treated as new. Import never records consent or activates the agent, even when the input contains active/consent fields. Exports guard against spreadsheet formula execution.

Open **Actions** for the complete relationship menu. Keyboard shortcuts on the contact pages:

- **A** explicitly records WhatsApp permission and enables/disables scope for the paired sender.
- **P** toggles human takeover.
- **N** adds a permanent relationship note. Use Actions to inspect/correct memories and edit relationship details, stage, next action and follow-up dates.
- **W** writes an optional manual message; **J** opens automatic activity and unresolved transport outcomes. Start Agent handles introductions and incoming replies without message approval.
- Use Actions to create meetings, record outcomes, opt-outs, prepare configured links, or delete a relationship. **M** opens meeting records.

Start Agent assesses enabled relationships using saved stages, conversation events and memory. It sends one introduction for a genuinely new relationship and answers new incoming messages automatically. Previously contacted relationships are not repitched merely because the app restarts. Every incoming message ID is a separate event, even when its text repeats; a saved replied stage never marks a later message as answered.

Meeting records are local CRM records. They do not create or cancel external calendar invitations. Configured successful/unsuccessful outcome links are sent automatically once per recorded outcome while the contact remains in scope and the agent is running. Quiet hours and opt-outs still apply.

### 4 — Settings

Configure the provider, optional model override, sales instructions, approved Atlas knowledge, response timing, daily send cap, quiet hours and meeting/outcome links. **V** checks provider readiness. **B** exports a complete relationship-memory backup; **O** restores a backup into an empty workspace. Restore resets all contacts inactive and does not import WhatsApp credentials.

Contact scope, sender identity, opt-outs, durable job IDs and dispatch-time permission checks are enforced in application code. Changing a prompt cannot bypass them.

## Model providers

**Codex:** run `codex login` and choose Sign in with ChatGPT. Oracle Leads uses the signed-in CLI with its normal usage limits. Each response runs in an ephemeral, read-only working directory with shell, patches, plugins, hooks, browser/computer use, multi-agent tools and native memory disabled, and requires a validated JSON response. The service owns the outreach tools. Subscription availability is checked, not inferred from a credential file. Login/2FA remains manual.

**Self-hosted:** reuses the existing Oracle endpoint configuration and key. To configure it:

```sh
oracle configure-selfhost --url https://YOUR-ENDPOINT/v1 --key-file /path/to/private/key
```

The previous RunPod deployment is not claimed to be available. Check Settings → Verify provider. Remote HTTP endpoints are rejected; loopback HTTP is allowed. Oracle Leads does not start paid compute or automatically switch providers. Conversation text sent to either provider leaves the local database for that inference endpoint.

## Permanent memory and recovery

Default workspace: `~/.local/share/oracle-leads/oracle-leads.sqlite`, overridden by `--data-dir` or `ORACLE_LEADS_DATA`. Database files are private and the workspace directory is restricted. One service may own a workspace at a time.

SQLite owns contacts, original messages, source-linked summaries, operator corrections, next actions, meetings, activity, operator chat, runs, jobs and auth. Model session history is disposable. Automatic relationship backups run hourly and on clean shutdown, retain the most recent 30 snapshots under `backups/`, and exclude WhatsApp credentials. Export and copy important backups to another storage device for hardware-loss protection. Backups can contain older copies of deleted relationships; manage retained copies accordingly.

Interrupted generation is reassessed after Start; generation failures retry with backoff. Interrupted sends become **uncertain**; they are never blindly retried. Activity exposes these exceptional outcomes for checking against WhatsApp. New incoming messages supersede stale responses. Permissions are tied to the sender, contact scope and settings revision. Internal action records persist timing and recovery data without requiring a review inbox. Delivery/read states depend on real transport receipts; an accepted send is not proof of delivery, interest or a sale.

## Verification

```sh
npm test
# Optional terminal QA dependencies, preferably in a venv:
pip install -r leads/tests/requirements-qa.txt
python3 leads/tests/directory_smoke.py
python3 leads/tests/pairing_smoke.py
python3 leads/tests/native_smoke.py
python3 leads/tests/terminal_smoke.py # compatibility UI
python3 leads/tests/installed_smoke.py
```

The terminal tests use synthetic contacts and a loopback fake WhatsApp transport. See [contacts verification](leads/docs/verification-directory-2026-10-17.md), [phone pairing verification](leads/docs/verification-phone-pairing-2026-10-17.md), [native interface verification](leads/docs/verification-native-2026-10-17.md) and [the service verification report](leads/docs/verification-2026-10-17.md) for measured checks and live limitations. No customer message was sent during development.

Voice transcription, image understanding, external calendar synchronization, and autonomous discovery are deferred. Baileys is an unofficial WhatsApp Web integration; QR readiness is tested separately from real account pairing and message delivery.

The former engine is retained in `engine.py` for configuration compatibility and regression diagnostics. Its historical documentation is in [docs/legacy-oracle-engine.md](docs/legacy-oracle-engine.md).

## Install the release

```sh
ONNXRUNTIME_NODE_INSTALL=skip npm install --global --prefix "$HOME/.local" https://github.com/aansh-afk/bismyth-lead-tui/releases/download/v0.6.0/bismyth-lead-tui-0.6.0.tgz
bismyth-leads
```

Saved WhatsApp sessions reconnect automatically while the outreach agent stays paused. `oracle-leads` and `oracle` open the same current interface; `oracle configure-selfhost` retains endpoint configuration.

The v0.1.x property-enquiry implementation remains in `src/`; its historical guide is in [docs/legacy-bismyth-leads.md](docs/legacy-bismyth-leads.md). The default launcher is the Oracle Leads outreach workspace. License notices for the retained Oracle engine are preserved in `ORACLE-LICENSE` and `UPSTREAM-NOTICE`.

## What Start agent does

1. Reuses the connected WhatsApp sender and assesses all enabled, permitted relationships. Import alone does not enable a contact; per-contact human takeover and opt-outs stay respected.
2. Sends a short tailored introduction once when the saved stage is new and no conversation is recorded. Saved contacted, meeting-booked and client stages are not treated as new prospects.
3. Treats each new WhatsApp message ID as a fresh event. The newest message, recent conversation, new event bundle, source-linked memory, saved stage, notes and configured links are supplied to the selected model. Identical text with a new message ID remains a new message.
4. Sends the response automatically. Interested prospects can receive the approved meeting link; declines close politely. Nurture and low-intent classifications require conversation evidence. A fresh inbound can still be assessed in those stages, unless the relationship opted out or is under human control.
5. Updates activity, memory and the relationship stage. Several messages during the response delay can receive one coherent response that considers each event. A newer message arriving during generation replaces a stale response.

Settings → Response timing defaults to a **5–15 second pause before composing and between automatic sends**; model generation time is additional. Set both values to zero for immediate processing. Incoming responses take priority over introductions. Quiet hours and the daily cap still delay dispatch. Each launch begins paused until you press Start Agent.

Context is contact-specific and bounded to recent conversation and stored memory; it does not import the full WhatsApp message archive. Saved stages and messages are the source of truth for prior contact. Starting does not create external calendar bookings or invent follow-up dates. Legacy draft APIs remain for compatibility and are not part of the autonomous UI flow.

## 5 — Sources (Firecrawl)

Press **5** or click **Sources**. Choose **Configure** to enter your Firecrawl API key in a masked field, or set `FIRECRAWL_API_KEY` before launching. The saved key is private to the local workspace (`firecrawl.key`, mode 0600), outside the database and exports. Blank removes a locally saved key. **Credits** checks the account's current balance; the page labels the cached value as last checked credits.

- **Search web** finds public business sources using a query, location, country and result limit.
- **Scrape URL** extracts public names, roles, company affiliations, phone numbers, emails and quoted evidence using structured JSON alongside page content. Missing names/companies stay unknown; a page title is never substituted for a person's name.
- **Collect** batch scrapes saved search results, up to the chosen 1–100 page limit. Already scraped pages are skipped unless **Refresh already scraped pages** is `yes`; older unnamed records are upgraded automatically. Repeat to collect the remaining discovered pages.
- **Crawl site** follows pages across the selected website with a 1–100 page limit (default 10). External domains and arbitrary subdomains are excluded; canonical www redirects are accepted. AREA member-directory crawls include member profiles and listing pagination while excluding unrelated events/news pages. **Runs** shows crawl/batch progress, reported credit usage, errors and cancellation. Existing saved jobs resume status checks after app restart; a lost start response is not retried automatically. Remote jobs can continue while Oracle is closed.
- **Manage → Reprocess saved directories · no credits** re-reads existing AREA and REAAK membership content locally. AREA profile headings, proprietor/associate blocks and paginated listing cards preserve the person → firm relationship; REAAK name/firm-only listings remain research records without borrowing the association's phone. No network call or CRM import occurs. Other website layouts remain unchanged and can use a fresh JSON scrape.
- **Contacts** lists extracted people and shared business contacts across saved pages. Select a record to inspect its role, company, contact methods and source pages. **Companies** groups related people using the stated company name plus its explicitly linked website, falling back to the source domain. Matching names on unrelated domains stay separate; these are sourced affiliations, not independently verified company identities.
- **Page contacts** shows only the selected source's records. Import an individual phone or use **Actions → Import all phones from this page**. **Manage → Import all saved phone contacts** imports unique phones across all sources. Shared phones become one relationship with associated people in its notes. Directory/association site contacts are skipped by bulk import and remain available for explicit individual import. Records without a phone stay in research. New contacts remain inactive without outreach permission; duplicates preserve their existing data, stage and sender. CRM company/role fields are filled, while email and source evidence are retained in notes. The current CRM has one company field per phone relationship; research retains separate affiliations and all evidence when a number is shared.
- **Manage → Export all sourced contacts as JSON** includes email-only records, company grouping and each source URL. The terminal contact/company lists show the first 1,000 records; export and bulk import include the complete saved catalog.
- **Actions → Delete this source** or **Manage → Delete all saved sources** removes research after confirmation. Imported contacts, conversations and memory survive. Cancel active research jobs before deleting so late results cannot recreate removed pages. Run history and older backups retain their historical records.

International `+country-code` numbers and phone/WhatsApp links are retained. Indian or North American local ten-digit phone numbers are normalized only when the corresponding calling code is explicitly selected and phone context is present. Other ambiguous local numbers are skipped. Extraction validates number format, not ownership or whether a number has WhatsApp. Sources and research runs persist in SQLite and relationship backups; restored crawl jobs are interrupted and do not resume remote activity.

Search, scrape, JSON extraction and batch/crawl requests use your Firecrawl account credits when you initiate them. No research runs automatically with Start Agent. Crawl polling and page saving continue independently of outreach quiet hours. Research does not enable messaging. The primary native TUI has all five pages; hidden legacy curses mode retains its original four-page interface.

Official API references: [Search](https://docs.firecrawl.dev/api-reference/endpoint/search), [Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape), [Crawl](https://docs.firecrawl.dev/api-reference/endpoint/crawl-post), [Crawl status](https://docs.firecrawl.dev/api-reference/endpoint/crawl-get), [Credit usage](https://docs.firecrawl.dev/api-reference/endpoint/credit-usage), [JSON mode](https://docs.firecrawl.dev/features/llm-extract), [Batch scrape](https://docs.firecrawl.dev/api-reference/endpoint/batch-scrape). See [Named contacts verification](leads/docs/verification-source-contacts-2026-10-17.md) and [Sources verification](leads/docs/verification-sources-2026-10-17.md) for test methods and live-service limits.

## Local Laya decisions

Laya runs on this device through the pinned `@receptron/laya` ONNX CPU runtime, in a separate worker so the TUI remains responsive. It classifies each new incoming event using the recent salesperson message and new message bundle. It does not generate customer messages. The selected Codex/self-hosted writer receives the full relationship context and the local intent hint, writes the reply, and verifies the classification. There is no additional Codex call just for Laya decisions and no human review queue.

```sh
bismyth-leads --setup-laya
```

Setup downloads about 1.7 GB into the local cache and verifies that the pinned checkpoint loads. Once installed, runtime inference reads local files only. Settings → **Decision engine** switches between **Local Laya + automatic writer fallback** and **Writer handles decisions**. Introductions and operator chat do not invoke Laya. Missing models, inference errors, non-Latin input, oversized context and uncertain classifications fall back automatically. This English checkpoint does not establish Hindi/Hinglish accuracy. The worker uses two CPU threads.

The initial integration uses Laya as an intent adviser. It cannot independently suppress a reply, opt out a contact, book a meeting or bypass permissions. Confidence alone is not evidence of correctness; see the local evaluation and limitations in [Laya/relogin verification](leads/docs/verification-laya-relogin-2026-10-17.md). The writer remains responsible for the final context-sensitive response and stage. No claim is made that this removes the writer call needed for each substantive reply.

Upstream: [Laya](https://github.com/NandhaKishorM/laya), [Node ONNX runtime](https://github.com/receptron/laya). Model revision: `d42786bdff8a7550316339c5fbf8f46caa83ea1b` from `receptron/laya-onnx`.

The running build version appears beneath the Oracle Leads logo. In compact terminals it appears on the right side of the status footer. The label comes from the compiled frontend version.
