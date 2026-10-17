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
npm ci
npm run build:tui # Rust toolchain required when building from source
npm start
```

The release includes a native Linux x86_64 frontend. Other Linux/macOS architectures can build it with `npm run build:tui`. The interface uses **Ratatui + Crossterm**, also used by OpenAI Codex CLI; it is an independent outreach interface backed by the existing Codex CLI integration.

Click navigation, contact rows, action buttons, menu options, confirmations and text fields. Use the mouse wheel to scroll lists/conversations; click inside a field to place the caret. Bracketed paste and arrow-key editing are supported.

The primary installed command is `~/.local/bin/bismyth-leads`. Optional local Oracle aliases open the same outreach app. Use a terminal at least **80×24** for normal operation. A WhatsApp QR can require about **80×46**; its page reports the actual minimum dimensions. Shrink the terminal font or enlarge the window to scan it.

## Four pages

Use **1–4** to switch pages, **Space** to start/pause the worker, **R** to refresh, and **Q** to quit. Escape returns from a view. Single-line forms save with Enter; multi-line editors save with **Ctrl+S**, **Ctrl+G**, or the Save button. **Ctrl+U** clears a field.

### 1 — Dashboard

Real counts for contacts, interest, meeting requests, booked local meetings, clients, sends, replies and drafts. Shows recent activity, follow-ups due and sampled active agent time. **C** focuses the persistent inline operator chat; type a question such as “What happened in the previous run?” or “What did we promise this client?”. **H** opens previous runs; **M** opens meeting records.

Dashboard chat is read-only: it can explain the records but cannot send messages, create bookings or alter contacts. It retrieves a bounded set of relevant relationships, source messages and memories instead of uploading the entire database. It identifies when additional records are needed.

### 2 — WhatsApp

**C** connects the local Baileys service and displays its QR. Scan it yourself from WhatsApp → Linked devices → Link a device. The connected phone identity comes from the paired account. Use **Disconnect** or **Unlink** with explicit confirmation. The inbox lists only contacts currently active for that sender.

If scanning fails, choose **Enter phone number** (or press **F** on page 2), also available as **Enter phone number instead** inside the QR dialog. Enter your WhatsApp number with its country code. Oracle shows an eight-character pairing code. On your phone, open **WhatsApp → Linked devices → Link a device → Link with phone number instead**, then enter that code. Keep the phone online; if WhatsApp rejects a code, request a fresh one or choose **Use QR**.

An entered number is only a pairing target. The account becomes the verified sender after WhatsApp confirms linking. An already-linked account must be explicitly unlinked before pairing another number. Pairing never activates contacts or starts automation. Codes are visible only in the private local pairing session and are cleared on success/disconnect; they are excluded from relationship backups and activity logs.

The service stores Baileys credentials/Signal keys in the private local SQLite database rather than the example multi-file auth store. It requests no full historical chat sync. Direct messages require an exact scoped number; WhatsApp LIDs require a legitimate explicit phone mapping. Groups, broadcasts, historical replay and unscoped contacts do not reach the relationship agent.

Account changes deactivate the old contact scope. A manual reply from the phone pauses automatic replies for that relationship. Temporary connection loss pauses the worker. Reconnect preserves credentials; it does not silently restart sending.

### 3 — Contacts

Your searchable directory combines saved Bismyth/Oracle leads with the contact metadata your linked WhatsApp account shares. Existing saved Bismyth phone contacts are loaded once into the default workspace; original saved runs remain unchanged. Separate `--data-dir` workspaces use explicit Import / Older runs. Later saved runs can be loaded with **Older runs**.

Click the visible search field or press **/** / **Ctrl+F**. Results and the selected preview update as you type; search names, company, role, notes, stage, or a phone number with normal spaces/brackets. **All**, **Enabled**, **WhatsApp** and **Saved** filters show the relevant source/access list. **Clear** restores the full list. Search text consumes normal typing, including page numbers and shortcut letters. Enter, Down, Tab or Escape leaves the search field.

Click a contact or use arrow keys to preview them. **Home/End** and **Page Up/Down** navigate long lists. The preview remains available at 80×24; **Overview**, **Chat** and **Memory** tabs show relationship context, saved conversation and permanent notes. The selected contact stays selected when data refreshes or their name moves in the list. **Actions** opens editing, meeting and consent controls; **Write** and **Drafts** remain visible.

WhatsApp metadata is synchronized separately from message history, after linked-device keys are ready. **Refresh WhatsApp** checks available contact-state updates. WhatsApp may not provide the entire phone address book or a usable phone identity for every contact; import a CSV/JSON file for missing numbers. Groups, broadcasts, the sender’s own entry and unresolved LIDs are excluded. Showing a person does not monitor their messages. Every newly listed contact starts inactive without consent; existing opt-outs and operator names remain authoritative. Explicit deletion suppresses automatic WhatsApp rediscovery.

**I** imports CSV/JSON, **L** loads older runs, and **E** exports contacts. Existing files and Oracle model settings remain in place.

CSV columns:

```csv
name,phone,company,role,source,notes
```

Use international phone numbers beginning with `+` and a country code. JSON accepts an array or `{ "contacts": [...] }`. Numbers are deduplicated. Import never records consent or activates the agent, even when the input contains active/consent fields. Exports guard against spreadsheet formula execution.

Open **Actions** for the complete relationship menu. Keyboard shortcuts on the contact pages:

- **A** explicitly records WhatsApp permission and enables/disables scope for the paired sender.
- **P** toggles human takeover.
- **N** adds a permanent relationship note. Use Actions to inspect/correct memories and edit relationship details, stage, next action and follow-up dates.
- **G** generates an opening draft; **W** writes one; **J** opens drafts and unresolved sends. Opening messages always require exact review.
- Use Actions to create meetings, record outcomes, opt-outs, prepare configured links, or delete a relationship. **M** opens meeting records.

Queueing opens a second review showing the exact message and recipient; choose **Queue message** or press **Y**. Enter cancels. The worker must be running, connected, within quiet-hour rules and below the daily cap.

Meeting records are local CRM records. They do not create or cancel external calendar invitations. Configured successful/unsuccessful outcome links produce a follow-up draft (or an approved-rule queue entry in automatic mode) once per outcome while the contact remains in scope. Quiet hours and opt-outs still apply.

### 4 — Settings

Configure the provider, optional model override, sales instructions, approved Atlas knowledge, review/automatic reply mode, daily send cap, quiet hours and meeting/outcome links. **V** checks provider readiness. **B** exports a complete relationship-memory backup; **O** restores a backup into an empty workspace. Restore resets all contacts inactive and does not import WhatsApp credentials.

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

Interrupted generation is cancelled. Interrupted sends become **uncertain**; they are never blindly retried. In a contact's draft list, check WhatsApp first, then manually resolve an uncertain send as sent or cancelled. New incoming messages invalidate stale drafts. Approval is tied to the sender, contact scope and settings revision. Delivery/read states depend on real transport receipts; an accepted send is not proof of delivery, interest or a sale.

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

Voice mode, external calendar synchronization, and autonomous discovery are deferred. Baileys is an unofficial WhatsApp Web integration; QR readiness is tested separately from real account pairing and message delivery.

The former engine is retained in `engine.py` for configuration compatibility and regression diagnostics. Its historical documentation is in [docs/legacy-oracle-engine.md](docs/legacy-oracle-engine.md).

## Install the release

```sh
npm install --global --prefix "$HOME/.local" https://github.com/aansh-afk/bismyth-lead-tui/releases/download/v0.2.5/bismyth-lead-tui-0.2.5.tgz
bismyth-leads
```

Saved WhatsApp sessions reconnect automatically while the outreach agent stays paused. `oracle-leads` and `oracle` open the same current interface; `oracle configure-selfhost` retains endpoint configuration.

The v0.1.x property-enquiry implementation remains in `src/`; its historical guide is in [docs/legacy-bismyth-leads.md](docs/legacy-bismyth-leads.md). The default launcher is the Oracle Leads outreach workspace. License notices for the retained Oracle engine are preserved in `ORACLE-LICENSE` and `UPSTREAM-NOTICE`.

## What Start agent does

Start agent unpauses the worker queue. An empty queue waits for incoming work; starting does not automatically create introductions for every enabled contact.

1. Connect WhatsApp, then select the intended contact on Contacts and enable their scope with recorded permission.
2. Use Actions → Generate an opening draft, or Write a message. Review the exact text in Drafts and confirm sending. Start the agent so the approved queue can run.
3. New replies from enabled contacts are saved to their relationship. With per-contact automatic handling enabled, the model uses the conversation, permanent memory and configured prompt to prepare a reply. Review mode keeps it as a draft; Auto mode queues it for dispatch.
4. Watch the contact conversation, drafts, activity and dashboard. Pause an individual contact for human takeover, or pause the agent to stop queue processing.

Quiet hours and the daily cap delay dispatch. Opt-outs stop that relationship. Pending drafts still need explicit review, and uncertain sends require checking WhatsApp before resolving them. Starting does not automatically book meetings or schedule follow-ups.
