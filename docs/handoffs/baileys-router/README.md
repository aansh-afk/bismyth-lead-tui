# Developer handoff: Bismyth WhatsApp router

Build and deploy a self-hosted **Baileys router** that the Bismyth property-enquiry TUI can consume. The router owns pairing, WhatsApp sessions and message transport. The TUI owns contacts, drafts, campaigns and manager-referral tracking.

**Status:** this package defines the v1 server contract, not a server implementation. The local TUI v0.1.15 implements its client, reviewed introduction flow and persistent operation/reply ledger. Your task is the external Baileys service, pairing and transport. Live WhatsApp integration still needs your deployed service and a selected test recipient.

## Business goal

Reach the decision-maker behind the first property contact: a sales manager, agency owner or business head. The first contact can introduce them, forward a message, or willingly share an official work number. An independent owner may already be the decision-maker.

Initial draft:

> Hi, Aansh here from Bismyth. I'm reaching out about sales operations and business partnerships. Are you the right person to speak with, or could you introduce me to your sales manager, agency owner or business head?
>
> You're welcome to forward this message. If they're happy to be contacted, their official work number would help. Thanks!

Send client-supplied text unchanged. Do not generate identities, pitches or telephone numbers. Incoming text/contact cards let the client record referrals and prepare a separate manager follow-up.

## Package

- `openapi.json`: REST contract, OpenAPI 3.1.0.
- `events.schema.json`: strict event envelope/payload schemas.
- `examples.json`: synthetic examples. Numbers are **not approved live destinations**; the send example uses `dryRun:true`.
- `.env.example`: configuration placeholders, no actual credentials.
- `acceptance-checklist.md`: behaviours to verify on the implemented service.
- `validate_contract.py`: offline contract/example checks; requires Python `jsonschema`.
- `validation-report.md`: results of those checks, not live server verification.

Use these v1 contracts instead of guessing from older build prompts. Return a documented versioned change if a required interface must differ.

## Scope and deployment

V1 covers text sends, pairing/status, known-number checks, bounded history, incoming text/contact cards, receipts and replayable events. Media sending, group campaigns, scheduling, AI agents and CRM UI are outside v1.

This service does not implement 99acres access, CAPTCHA handling, property enquiries or a buyer inbox. The user has no 99acres account yet; that account-message source remains unverified. Support contacts imported from other legitimate sources independently.

Use a supported Node runtime and pinned, tested Baileys release. Persist WhatsApp auth/Signal keys and operations/events in durable storage; SQLite is acceptable for a single-node deployment. Use a production auth-state store: the [Baileys connection documentation](https://github.com/WhiskeySockets/baileys.wiki-site/blob/main/docs/socket/connecting.md) warns against deploying its multi-file example unchanged.

Deliver Docker setup with durable volumes, non-root execution, health checks and graceful restart. Only one active socket may own a session. Reuse valid auth after restart. For remote deployment, use TLS and explicit client-origin configuration. QR strings, keys and auth material must stay out of logs/source control. This is Baileys transport, not Meta Cloud API. [Baileys project](https://github.com/WhiskeySockets/Baileys)

## Authentication

All REST endpoints require `X-API-Key`. Scope keys to permitted sender sessions or an equivalent server-side owner mapping. Reject another session's reads, pairing, sends and operation lookup. A UUID is not authorization.

Socket.IO authenticates with `auth: {apiKey,userId,after}` and joins only that session's room. Do not put keys in query strings. The TUI receives no WhatsApp encryption/auth credentials.

## REST routes

| Operation | Route |
|---|---|
| Health/version/readiness | `GET /api/health` |
| Create/reuse a session | `POST /api/auth/create-session` |
| List permitted sessions | `GET /api/auth/sessions` |
| Session status | `GET /api/auth/status/{userId}` |
| Current pairing QR | `GET /api/auth/qr/{userId}` |
| Preview/send text | `POST /api/messages/send` |
| Resolve an interrupted send | `GET /api/operations/by-client-request/{userId}/{clientRequestId}` |
| Chat list | `GET /api/chats/{userId}` |
| Chat history | `GET /api/chats/{userId}/{chatId}/messages` |
| Check a supplied number | `GET /api/contacts/{userId}/check/{phone}` |
| Replay events | `GET /api/events/{userId}` |

Read `openapi.json` for exact field names/types. Success bodies have no undocumented `data` wrapper. Use RFC3339 times, opaque IDs/cursors and bounded pagination (default 50, maximum 100). URL-encode phone/chat path values. Session creation uses `{name,clientRequestId}` and must be idempotent so a replay does not create another session. Pairing returns current `qrRaw` plus expiry; an already connected session returns `409 ALREADY_CONNECTED`.

## Send semantics

The request is `{userId,to,message,clientRequestId,dryRun}`; `dryRun` is required. Preview validates the request and returns `status:"preview"`, `operationId:null`, `messageId:null`. It must make **zero transport calls**, create no send operation, and emit no sent/delivered receipt. Preview does not reserve a live-send idempotency key.

For `dryRun:false`, require an authorized, connected sender. Persist an operation/idempotency key before worker handoff. Return `202` only after durable acceptance. Repeating the same key and identical semantic payload returns the original operation with `200`; changing sender/recipient/text yields `409 IDEMPOTENCY_CONFLICT`. Concurrent requests share the durable uniqueness check.

Acceptance is not delivery. Return the actual Baileys message ID when known; advance status only from real acknowledgements/receipts. If a crash happens after transport handoff but before reliable confirmation, reconcile or retain `uncertain` for review. Do not promise exactly-once WhatsApp delivery or blindly retry an ambiguous send. V1 has no automatic campaign retry endpoint.

## Events and phone identity

Use Socket.IO names `connection`, `qr`, `message`, `message:status`; each uses the envelope `{eventId,cursor,userId,type,occurredAt,data}` defined in `events.schema.json`. Publish only durable events and return the same envelopes from REST replay.

On connection, replay events after `auth.after` before live events, without a gap. Clients deduplicate by event/message ID. Expired retention cursors produce an explicit `CURSOR_EXPIRED` response/event rather than a silent gap.

Normalize `fromMe` and `isHistorical` separately; history must not trigger a fresh automated reply. Include actual text and supplied contact-card names/phones. Unsupported media stays typed with null text; transcription is not required.

Preserve `remoteJid` and `chatId`. A WhatsApp LID is not a telephone number: populate `senderPhone` only from an explicit legitimate mapping, otherwise null. A number check establishes availability, not that the WhatsApp user owns a property listing. Process only the selected sender and outreach contacts at the client layer, rather than treating all personal chats as leads.

## Errors and reconnect

Use `{requestId,error:{code,message,retryable}}`, with no secrets or private message bodies in errors.

| HTTP | Example codes |
|---|---|
| 400 | `INVALID_REQUEST`, `INVALID_PHONE` |
| 401 | `AUTH_REQUIRED`, `INVALID_API_KEY` |
| 403 | `SESSION_FORBIDDEN` |
| 404 | `SESSION_NOT_FOUND`, `OPERATION_NOT_FOUND` |
| 409 | `SESSION_NOT_CONNECTED`, `ALREADY_CONNECTED`, `IDEMPOTENCY_CONFLICT` |
| 410 | `CURSOR_EXPIRED` |
| 429 | `RATE_LIMITED`; supply `Retry-After` |
| 503 | `ROUTER_NOT_READY`, `TRANSPORT_UNAVAILABLE` |

Do not retry sends solely because `retryable` is true; resolve the original operation first. Temporary disconnects preserve credentials. Genuine logout requires pairing. Do not delete auth or create replacement sessions as routine repair.

## What to deliver back

Return the repository/commit, pinned versions, deployment commands, backup/restart procedure, secure key setup, actual base URL, API version `1`, selected sender-session ID, and a Markdown acceptance report with failures/limitations.

TUI v0.1.15 client settings:

```text
BISMYTH_WHATSAPP_ROUTER_URL=https://your-router.example
BISMYTH_WHATSAPP_ROUTER_API_KEY=<local secret>
BISMYTH_WHATSAPP_SESSION_ID=<sender-session UUID>
```

These names are implemented in the local TUI v0.1.15. Keep real secrets out of the repository/reports. Demonstrate live pairing/send/reply only with a user-selected test account and recipient; fixture checks are not live integration proof.
