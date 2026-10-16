# Router acceptance checklist

Record commit, pinned Baileys/Node versions, deployment, setup, method, measured outcomes, failures and limitations. Use a user-selected test account/recipient. Synthetic example numbers are not live destinations.

## Contract and access

- REST and events match the supplied schemas.
- Missing/invalid key is rejected; another session is forbidden for REST, operation lookup, Socket.IO and replay.
- Session lists expose only permitted sessions; keys, QR strings and auth material stay out of logs.
- Pagination is bounded; cursors are stable and expiry is explicit.

## Pairing/restart

- A new session exposes QR and becomes connected with the actual linked number.
- Replaying create-session does not create another session.
- QR rotation/expiry and already-connected behaviour match the contract.
- Restart reuses auth; one active socket owns each session.
- Temporary disconnect preserves auth; genuine logout requires pairing.

## Sends

- Preview makes zero transport calls, creates no operation and emits no sent receipt.
- Live send uses the selected session and preserves recipient/text.
- Replayed/concurrent identical keys do not enqueue duplicate sends.
- Reused keys with changed payload produce an idempotency conflict.
- Test crashes before queue acceptance and after transport handoff separately.
- Ambiguous sends stay uncertain until reconciled, without automatic resend.
- Real receipts drive sent/delivered/read; acceptance alone is not delivery.

## Replies/referrals

- Text, direction, time, message ID and sender mapping are accurate.
- Contact-card numbers remain as supplied; unresolved LIDs stay unmapped.
- History is marked historical; replay cannot generate duplicate replies.
- Socket reconnect recovers missed events without cross-session leakage or a replay/live gap.
- A controlled manager-introduction reply/referral reaches the client interface. Do not claim the current TUI processes it yet.

## Deliverable

- Supply repository/commit, deployment commands, volume backup/restore and health check.
- Provide actual endpoint/version, secure key setup and sender-session ID.
- Report schema/fixture checks separately from live pairing, sends and replies.
