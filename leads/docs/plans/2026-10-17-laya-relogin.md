# Local decisions and WhatsApp relogin

The operator approved local Laya classification with automatic Codex fallback. The existing writer remains Codex or the selected self-hosted provider. Permission, quiet hours, daily limits, fresh-message checks and transport idempotency remain deterministic.

Use pinned @receptron/laya ONNX inference on CPU in a separate worker. Download a pinned English checkpoint explicitly during setup; runtime loads only local files. Laya classifies a compact recent conversation plus the explicit new event. Record decision provenance. Reject missing, malformed, non-English or oversized inputs and uncertain answers; the existing model handles these automatically. Domain verification determines which decisions can be applied; confidence alone does not establish correctness. Do not suppress replies or opt out contacts solely from an unvalidated classifier.

On expired credentials, pause sending and persist a relogin requirement and the verified sender. Show a dismissible prompt on any TUI page, plus a persistent recovery action. Offer phone code for the same number or QR. Replace expired authentication only, retain CRM and contact scope, verify the linked identity before accepting it, and reject a different account until explicit unlink. After successful relogin leave the agent paused for Start Agent. Temporary network loss continues automatic reconnect.

Implementation: add decision worker/setup/adapter; integrate structured hints and validated stage mapping with the writer; add decision settings/status; persist auth-expiry recovery and expose recovery API; add native prompt/actions; test isolated fakes and real local inference; write verification report, build and install without restarting the live session.

Validation decision: the real CPU evaluation returned 16/26 correct; one of seven high-confidence accepted candidates was also wrong. Keep local intent output advisory. A real Codex call corrected the known timing error to nurture. Final-stage authority requires stronger domain validation or a specialized checkpoint; the present implementation does not claim that capability.
