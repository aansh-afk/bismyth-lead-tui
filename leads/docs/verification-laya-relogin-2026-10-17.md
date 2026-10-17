# Laya and same-number relogin verification — 2026-10-17

## Method and boundaries

Tests use Node 24.13.0, Rust 1.97, Ratatui/Crossterm and isolated SQLite workspaces. Transport and customer text in tests are synthetic. Real Laya evaluation loads the pinned ONNX model locally on the Intel i5-1135G7 CPU with two inference threads. No live customer contacts, WhatsApp messages, account relinking or quiet-hour changes are used for verification. The running live app is not restarted by this update.

## Observations

- Service tests cover local-decision parsing/fallback, repeated incoming event context, cancellation, stale context before writer launch, authenticated recovery API, auth expiry, persistence over restart, same-number recovery, wrong-account QR rejection, retained CRM/scope, and network reconnect.
- Native relogin smoke: seven real SGR mouse clicks; automatic Dashboard prompt, Later dismissal, persistent Relogin action, same-number phone code/QR and instructions at 128×40 and 80×24. Passed in 10.44 seconds.
- Existing phone-pairing smoke: seven clicks, QR/phone fallback, code and instructions at wide/compact sizes. Passed in 7.57 seconds.
- Rust unit tests: 4/4. Strict clippy and formatting checks pass. Release native build completed.

- Final service suite: **103/103 passed**, 10.900 seconds.
- Full native smoke: 34 real mouse clicks; import/scope, memory, meetings, automatic introduction and two distinct repeated-text inbound events, no review drafts, settings and three terminal sizes. Passed in 37.16 seconds.
- Final relogin smoke with the shortened prompt: passed in 10.02 seconds.

### Real CPU classification

26 synthetic outreach examples, eight intent options, fixed questions, two CPU threads, model revision `d42786bdff8a7550316339c5fbf8f46caa83ea1b`. Measured **16/26 correct (61.5%)**. The probability/margin filter accepted seven; **six of seven were correct**, so a confidence filter alone does not establish safe authority. In particular, “Not interested right now, please reach out in February” became `declined` at probability 0.9008 rather than `later`. Product questions also sometimes became interest. This result is why the shipped integration supplies hints and requires the writer's full-context assessment; it cannot replace the final stage decision yet.

Cold first request including worker/model load: **6,724 ms**. Warm median: **1,915 ms**; warm p95: **2,006 ms**. Total 26-case run: **54,607 ms**. Process RSS after inference: **1,680 MiB**. This is laptop CPU measurement, not the upstream GPU latency claim. The small synthetic set is a diagnostic, not a production accuracy estimate.

### Real Laya with isolated agent

Real local inference plus a synthetic writer/transport processed two identical-text messages with distinct IDs into two distinct automatic responses. No review drafts. Oversized input fell back with `context_too_long`; both substantive pricing questions fell back for uncertainty. Total: **9,333 ms**. Maximum sampled event-loop delay was **160 ms**, including initial synchronous SQLite setup; this does not isolate inference-induced UI latency. No WhatsApp connection was created.

Raw synthetic records: `/tmp/oracle-leads-laya-probe.json` and `/tmp/oracle-leads-laya-agent-probe.json`. Reproduce from the repository with `node leads/tests/laya_probe.mjs --run` and `node leads/tests/laya_agent_probe.mjs --run` after setup.

## Limitations and conclusions

Laya is a local intent adviser in this release. It does not independently suppress messages, opt out contacts or control delivery. The selected writer checks the full conversation and handles uncertainty without a human queue. The checkpoint is English; automatic fallback covers non-Latin scripts and oversized context. Latin-script non-English text and Hinglish are not certified by these tests. A high reported probability is not proof of correctness.

Live WhatsApp expiry/relogin still requires a real expiry and user pairing on their phone; synthetic events verify application behavior, not WhatsApp's acceptance of a fresh pairing. Successful relogin leaves outreach paused until Start Agent. Quiet hours and existing scope enforcement are unchanged.

## Setup issues

Initial npm dependency installation used the shell's Node 20 and emitted an engine warning. All service execution uses Node 24. The CPU runtime is included; the installer skips optional CUDA downloads. No GPU hosting or paid endpoint was provisioned.

## Real writer correction

A real Codex subscription call received the real Laya `declined` hint (0.9008) for the February request and corrected the result to `nurture`, with `optOut=false` and a polite acknowledgement. Combined cold local assessment and writer: **12,870 ms**. No transport was created. Reproduce with `node leads/tests/laya_writer_probe.mjs --run`; this explicitly invokes subscription inference. This checks one known failure, not all future writer decisions.

## Local artifact checksums

- `laya.onnx` (3807291 bytes): SHA-256 `a874eb254b58b0fcb1e7ad56fbb188c29d64e08c9a46b689433e1f52c66dba1e`.
- `laya.onnx.data` (1685258240 bytes): SHA-256 `487746363a8da57bcadb4345352997d22a0fb90d70aa22c6856668d023242aba`.
- `laya_config.json` (355 bytes): SHA-256 `c4fab3dd16b6ffdb432ae99334c77fca31e1b4beb0b81be76ca45f707709706a`.

## Installed update

The global `bismyth-leads`, `oracle-leads` and `oracle` commands all report 0.4.0. The installed `bismyth-leads --setup-laya` reused the cached checkpoint, completed a real forward pass and exited successfully without starting the CRM service. Installed native relogin smoke passed in **10.19 seconds**, including seven mouse clicks and both terminal sizes. Archive files were compared byte-for-byte with source and installation; 45 files matched. Model weights, dependency trees, databases and session keys are excluded from the archive.

This is one CPU benchmark run on the user's normal laptop, with other applications present. It does not isolate power mode, thermal state or background load. The real writer correction is one synthetic case. No developer-created message was sent to a real customer. Final delivery uses the same code/binary as these checks; the final repack includes this report update only.
