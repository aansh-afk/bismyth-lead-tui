# Oracle Leads — approved outreach product

Approved by the user's page-by-page brief, persistent-memory discussion and “build it”. Oracle Leads is exclusively an outreach and customer-relationship application. It does not expose coding-agent functionality.

## Product and frame

Four destinations: Dashboard (analytics, run history, operator chat, meetings), WhatsApp (QR pairing, scoped inbox, manual and automatic replies), Contacts (CSV/JSON and legacy-run import, export, explicit activation, relationship memory), Settings (provider choice, instructions, links, safeguards, backup).

The user explicitly chose Terminal TUI. Use Python curses with four keyboard-accessible pages, a startup provider picker, scoped conversation views and an in-terminal QR. Minimum terminal dimensions: 70 columns by 20 rows; pairing reports the larger dimensions needed by the actual QR. No seeded or fabricated customers or analytics.

## Architecture

Independent package in `oracle/leads`, using Node 24's SQLite and HTTP modules and a Python standard-library terminal interface. The service binds to loopback, validates Host/Origin, and uses a same-site session cookie and explicit mutation header. SQLite transactions own contacts, conversations, meetings, activity, jobs, settings and Baileys credentials. Persist memory independently of model sessions. Preserve existing Oracle configuration and Bismyth runs; importing never modifies the originals.

## Providers and access

Choose Codex subscription (default) or the existing self-hosted endpoint explicitly. No silent fallback or GPU provisioning. Codex runs with normal ChatGPT authentication, isolated per-request working directory, structured output and tools disabled. Self-hosted inference uses the existing endpoint/key without exposing secrets to the browser. The application executes the narrow outreach actions; models never receive general coding access.

Imported contacts start inactive. Operator activation and WhatsApp permission are separate from import. Only active, permitted, non-opted-out contacts bound to the current verified sender can be ingested, retrieved for conversation inference, or sent messages. Recheck that scope at dispatch. Switching sender suspends old activations. Unmapped WhatsApp LIDs, groups, broadcasts and unrelated chats are excluded. Historical replay never triggers a new reply.

## Persistence and automation

Store original messages, editable operator notes and source-linked model summaries. Keep suggestions separate from confirmed facts. Durable send jobs use stable IDs; interrupted transport operations become uncertain and are never blindly retried. Agent jobs are serialized and pauseable; human takeover disables automatic replies for that contact. Imported contacts do not receive automatic opening messages. Explicitly reviewed opening messages start outreach; enabled incoming replies may be answered automatically while the worker is running.

Meeting requests, confirmed local records, completed meetings and outcomes are distinct. Local meeting records do not claim an external calendar invitation. Outcome links are configured and queued only through explicit operator actions. Run heartbeat records recover prior interrupted runs and distinguish app uptime from active agent runtime.

## Validation

Test scope enforcement before ingestion/model invocation and again after generation, account changes, opt-outs, historical messages, concurrent replies, idempotency, uncertain restart recovery, import/export, persistent memory and meeting lifecycle. Exercise real HTTP routes and inspect all four pages. Separate deterministic/local checks from live Codex inference, real QR pairing and WhatsApp delivery. No live message is authorized by development testing.

Voice and external calendar synchronization are deferred. Real pairing remains a user action.
