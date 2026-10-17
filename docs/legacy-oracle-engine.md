# Oracle

A local `oracle` command that reuses the open-source Codex CLI engine with an
independent self-hosted model, settings, and session history. This version keeps
the upstream terminal UI; it is not a source-level rebrand of Codex.

## Current status

The launcher is installed locally. Automated checks exercise the real installed
Codex engine against a deterministic HTTP fixture, including a local file edit,
tool-result round trip, and session resume. These checks do not run Qwen.

The user supplied Pod `j1u6loy122s8mr` was a Secure Cloud RTX 4090 in EU-CZ-1 at
the observed $0.89/hour compute rate, with network volume `t4jid2rhiz` mounted
at `/workspace`. Authenticated Jupyter, direct SSH, live local file edits,
test execution, and session resume were verified during that deployment.
Three 384-token benchmark runs measured a median backend generation rate of
109.57 tokens/second with the original 8K context and FastMTP profile. This is
not a measurement of the later 256K profile, which disables draft acceleration.
The latest account read on 2026-10-16 lists no Pods; the saved endpoint is offline.
See [`docs/context-256k-2026-10-16.md`](docs/context-256k-2026-10-16.md) and
[`docs/runpod-live-2026-10-16.md`](docs/runpod-live-2026-10-16.md).
The earlier cheaper
Community 4090 and 3090 attempts were blocked by capacity. The request file
still describes the cheaper 3090 option; it is not the running Pod's inventory.

## Run

```bash
oracle --help
oracle connect
oracle configure --url https://YOUR_POD_ID-8080.proxy.runpod.net/v1 \
  --key-file /home/aansh/.local/share/runpod-qwen/api-key
oracle doctor --chat
cd /path/to/your/project
oracle
oracle 'fix the failing test'
oracle exec 'inspect this project and explain its structure'
oracle resume --last
oracle benchmark --runs 3 --tokens 384
oracle benchmark --prompt-file representative-repository-prompt.txt
```

`configure` requires an actual model endpoint. `doctor --chat` checks model
discovery, authentication, and a short Responses API answer. For an SSH tunnel,
`http://127.0.0.1:PORT/v1` is also accepted. Remote HTTP URLs are rejected to avoid
sending credentials in plaintext. Redirects are rejected instead of forwarding
the credential elsewhere. API keys are never included in process arguments.

On this PC, Oracle is configured to use `http://127.0.0.1:18081/v1`. A local
compatibility bridge forwards to the SSH tunnel on port 18080, connected to
Pod `j1u6loy122s8mr`. `oracle connect` opens or reuses the tunnel and starts the
bridge. `oracle disconnect` closes only the tunnel; it does not stop the Pod or
its billing. Tunnel details are stored in `~/.config/oracle/tunnel.json`.
Restart an Oracle session opened before this endpoint was configured.

The bridge combines Codex's system/developer instruction messages, in order,
into one initial instruction block required by this model's chat template.
User messages and tool calls/results remain separate and unmodified. The
bridge binds only to loopback and requires the same model-server key. It does
not replace the model or route inference to another provider.

Normal arguments are forwarded to Codex, including `exec`, `resume`, `review`,
`--cd`, and `--sandbox`. Run `oracle engine-help` for engine options. The initial
configuration uses workspace-write permissions and on-request approvals. Shell
tools inherit Codex's execution and approval behavior; Oracle does not add a
second sandbox. Only use the upstream bypass options when you intend to change
those permissions.

## Configuration and isolation

- Settings and model-server key: `~/.config/oracle/` (key file mode 0600).
- Codex state and history: `~/.local/share/oracle/codex/`.
- Benchmark reports: `~/.local/share/oracle/benchmarks/`.
- Optional `ORACLE_API_KEY` overrides the saved model-server key.
- `XDG_CONFIG_HOME` and `XDG_DATA_HOME` relocate Oracle's directories.
- Existing `~/.codex` configuration and ChatGPT login are not copied or edited.
- Repository-specific Codex configuration and `AGENTS.md` remain upstream
  behavior. Explicit command-line options can override Oracle's defaults.

Oracle uses direct function tools, compact instructions, and an explicit Qwen
model catalog. The configured context is 262144 tokens (256K); automatic
compaction starts at 131072 tokens (50%). Set `--context` during `configure`
only after changing the server's actual context size. Full-window quality and
compaction at this capacity have not been tested. The first deployment
is text-only; the optional vision projector is not downloaded.

## RunPod deployment

`deploy/bootstrap.sh` builds the model author's pinned llama.cpp revision and
FastMTP patch, downloads Q4_K_P plus the sidecar at a pinned model revision,
checks both SHA-256 hashes, and starts the authenticated API on port 8080.
The current launch profile uses 256K context and q4_0 K/V cache without the
optional FastMTP draft, which did not fit alongside that context on 24 GB VRAM.
Thinking defaults off to favor interactive latency. CUDA architecture is
detected from the GPU (86 for a 3090, 89 for a 4090), with an optional
`ORACLE_CUDA_ARCH` override. The compiler path is explicit because noninteractive
SSH sessions do not inherit the image's CUDA PATH. Completed downloads are
hash-checked and reused.

`deploy/pod.json` documents the request, without a secret. Through the connected
RunPod MCP, read current Community availability and pricing first, then create
with the JSON fields plus `entrypoint: ["/bin/bash", "-c"]`,
`cmd: [<contents of bootstrap.sh>]`, and `env.LLAMA_API_KEY` loaded from the local
key file. Let the scheduler choose placement rather than assuming a Secure
Cloud data center has Community stock. Never create a duplicate while an
earlier create outcome is uncertain.

The GPU bills while running, including build and download time. Storage bills
separately. `deploy/pod.json` requests a 50 GB host-local persistent disk, which
is deleted on termination. The user's actual Pod instead has a separately
managed network volume; do not delete it as part of Pod cleanup. The bootstrap
uses `/workspace/oracle` by default, with an optional `ORACLE_WORKSPACE`
override, and logs to `/workspace/oracle/bootstrap.log`. The service currently
runs as a detached process; after stopping/restarting the Pod, its service and
SSH tunnel must be re-established using fresh connection details. Require a
successful local tunnel health check and authenticated generation before
reporting readiness.

## Performance

The acceptance target is at least 30 generated tokens/second. The benchmark
reports each run's first-token latency, prompt/output token counts, total time,
end-to-end rate, and backend generation rate if supplied. At least 128 output
tokens are required per sample. Missing server timing leaves the generation
target **UNVERIFIED** rather than treating a different metric as equivalent.
Failure reports are written even when the endpoint is unavailable. Benchmark
output text is not saved; report files include endpoint and timing information.
Use a representative repository prompt to assess prompt-processing latency.

## Verify locally

```bash
cd /home/aansh/LTF1/oracle
python3 -m unittest discover -s tests -v
```

Python 3.11+ and an installed `codex` executable are required. No Python
dependencies are needed. The tested engine version is `codex-cli 0.160.1`.

## Upstream evidence and license

Inspected [openai/codex](https://github.com/openai/codex) at
`fa46ef3af641f21d0facc69bd11e562fce6a3f9a`. Relevant source:

- `codex-rs/model-provider-info/src/lib.rs`: custom provider and Responses wire API.
- `codex-rs/protocol/src/openai_models.rs`: direct tool mode and model metadata.
- `codex-rs/core/src/tools/spec_plan.rs`: tool selection from model metadata.
- `codex-rs/models-manager/models.json`: model-catalog format.

The catalog structure is adapted from that Apache-2.0 project. Its license and
notice are retained in `LICENSE` and `UPSTREAM-NOTICE`. The Codex executable is
used as a separately installed dependency. Oracle is an independent local tool.

Model repository:
https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF
