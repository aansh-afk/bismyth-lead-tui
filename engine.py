#!/usr/bin/env python3
"""Oracle: isolated Codex harness for a self-hosted Responses API."""
import argparse
import datetime as dt
import getpass
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import statistics
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
VERSION = "0.1.0"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the server credential to a redirect destination.
        return None


def locations():
    config = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "oracle"
    data = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "oracle"
    return config, data


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Set permissions at open time, including when a key is first created.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(value)


def valid_url(value):
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Endpoint must not contain credentials, query parameters, or a fragment.")
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Endpoint must be an HTTP(S) URL ending in /v1.")
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Remote endpoints must use HTTPS.")
    if parsed.path.rstrip("/") != "/v1":
        raise ValueError("Use the API base URL ending in /v1, not a chat or responses route.")
    return value.rstrip("/")


def settings(required=True):
    config, _ = locations()
    path = config / "settings.json"
    if not path.exists():
        if required:
            raise ValueError("No endpoint configured. Run: oracle configure --url https://POD-8080.proxy.runpod.net/v1")
        return None
    value = json.loads(path.read_text())
    value["url"] = valid_url(value["url"])
    return value


def api_key():
    value = os.environ.get("ORACLE_API_KEY", "").strip()
    if not value:
        path = locations()[0] / "api-key"
        value = path.read_text().strip() if path.exists() else ""
    if not value:
        raise ValueError("No server key. Set ORACLE_API_KEY or use oracle configure --key-file PATH.")
    if "\n" in value or "\r" in value:
        raise ValueError("API key must be a single line.")
    return value


def request(config, route, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = Request(config["url"] + route, data=data, headers={
        "Authorization": "Bearer " + api_key(),
        "Content-Type": "application/json", "Accept": "application/json",
    })
    try:
        return build_opener(NoRedirect).open(req, timeout=120)
    except HTTPError as error:
        # Avoid exposing arbitrary upstream bodies, which may echo request secrets.
        hint = {401: "server rejected the API key", 404: "API route was not found",
                502: "model server has not started or is unavailable",
                503: "model is loading or unavailable", 524: "RunPod proxy timeout"}.get(error.code, "request rejected")
        raise ValueError(f"HTTP {error.code}: {hint}.") from None
    except URLError as error:
        raise ValueError(f"Cannot reach model server: {error.reason}") from None


def configure(argv):
    parser = argparse.ArgumentParser(prog="oracle configure")
    parser.add_argument("--url", required=True)
    parser.add_argument("--model", default="qwen3.8-27b")
    parser.add_argument("--context", type=int, default=262144)
    parser.add_argument("--key-file", type=Path)
    args = parser.parse_args(argv)
    url = valid_url(args.url)
    if not 4096 <= args.context <= 262144:
        raise ValueError("Context must be between 4096 and 262144 and match the server.")
    if not args.model.strip():
        raise ValueError("Model name must not be empty.")
    if args.key_file:
        key = args.key_file.read_text().strip()
    elif os.environ.get("ORACLE_API_KEY"):
        key = os.environ["ORACLE_API_KEY"].strip()
    else:
        key = getpass.getpass("Model server API key: ").strip()
    if not key or "\n" in key or "\r" in key:
        raise ValueError("A nonempty single-line server key is required.")
    config, _ = locations()
    private_write(config / "api-key", key)
    private_write(config / "settings.json", json.dumps({"url": url, "model": args.model, "context": args.context}, indent=2) + "\n")
    print(f"Oracle configured: {url}\nModel: {args.model}; context: {args.context}\nRun oracle doctor to verify the connection.")
    return 0


def doctor(argv):
    parser = argparse.ArgumentParser(prog="oracle doctor")
    parser.add_argument("--chat", action="store_true", help="also generate a short Responses API answer")
    args = parser.parse_args(argv)
    binary = shutil.which("codex")
    print(f"Oracle {VERSION}\nCodex engine: {binary or 'MISSING'}")
    print(f"Isolated state: {locations()[1] / 'codex'}")
    if not binary:
        raise ValueError("Install Codex CLI first: https://github.com/openai/codex")
    config = settings()
    with request(config, "/models") as response:
        models = json.load(response)
    ids = [item["id"] for item in models.get("data", [])]
    if config["model"] not in ids:
        raise ValueError(f"Configured model is not advertised by the server. Available model IDs: {ids}")
    print(f"Authenticated model discovery: PASS ({config['model']})")
    if args.chat:
        start = time.perf_counter()
        with request(config, "/responses", {"model": config["model"], "input": "Reply with exactly ORACLE_READY.",
                                            "max_output_tokens": 32, "stream": False}) as response:
            result = json.load(response)
        text = "".join(part.get("text", "") for item in result.get("output", [])
                       for part in item.get("content", []) if part.get("type") == "output_text")
        if "ORACLE_READY" not in text:
            raise ValueError("Responses endpoint did not return the expected readiness marker.")
        print(f"Responses generation: PASS ({time.perf_counter() - start:.2f}s)")
    return 0


def tunnel(argv, disconnect=False):
    parser = argparse.ArgumentParser(prog="oracle disconnect" if disconnect else "oracle connect")
    parser.parse_args(argv)
    config, _ = locations()
    saved = config / "tunnel.json"
    if not saved.exists():
        raise ValueError("No SSH tunnel configured. Direct HTTPS endpoints do not need oracle connect.")
    connection = json.loads(saved.read_text())
    ssh = ["ssh", "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
           "-o", "ConnectTimeout=20", "-o", "StrictHostKeyChecking=yes",
           "-o", "UserKnownHostsFile=" + connection["known_hosts"],
           "-i", connection["identity"], "-p", str(connection["port"])]
    target = connection["user"] + "@" + connection["host"]
    forward = f"127.0.0.1:{int(connection['local_port'])}:127.0.0.1:{int(connection['remote_port'])}"
    pidfile = config / "tunnel.pid"
    pid = int(pidfile.read_text()) if pidfile.exists() else None
    active = False
    if pid:
        try:
            args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b'\0')
            active = all(value.encode() in args for value in (forward, target, connection["identity"]))
        except OSError:
            pass
    if disconnect:
        if active:
            os.kill(pid, signal.SIGTERM)
            for _ in range(100):
                try:
                    with socket.create_connection(("127.0.0.1", int(connection['local_port'])), timeout=0.2):
                        time.sleep(0.1)
                except OSError:
                    break
            else:
                raise ValueError("Oracle tunnel has not closed yet; its process remains tracked.")
        pidfile.unlink(missing_ok=True)
        print("Oracle SSH tunnel disconnected. The remote Pod continues running and billing.")
        return 0
    if not active:
        try:
            with socket.create_connection(("127.0.0.1", int(connection['local_port'])), timeout=0.2):
                raise ValueError("Oracle's local tunnel port is already occupied by an untracked process.")
        except OSError:
            pass
        with (config / "tunnel.log").open("a") as log:
            process = subprocess.Popen(ssh + ["-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
                                             "-o", "ServerAliveCountMax=3", "-L", forward, target],
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        private_write(pidfile, str(process.pid))
        for _ in range(100):
            if process.poll() is not None:
                raise ValueError("SSH tunnel failed; inspect ~/.config/oracle/tunnel.log.")
            try:
                with socket.create_connection(("127.0.0.1", int(connection['local_port'])), timeout=0.2):
                    time.sleep(0.1)
                    if process.poll() is not None:
                        raise ValueError("SSH tunnel exited during startup; inspect ~/.config/oracle/tunnel.log.")
                    break
            except OSError:
                time.sleep(0.1)
        else:
            process.terminate()
            raise ValueError("SSH tunnel did not start within 10 seconds.")
    ensure_bridge()
    print(f"Oracle SSH tunnel active on 127.0.0.1:{connection['local_port']}; compatible API on 127.0.0.1:18081. Run oracle doctor --chat.")
    return 0


def ensure_bridge():
    def ready():
        req = Request("http://127.0.0.1:18081/oracle/health", headers={"Authorization": "Bearer " + api_key()})
        try:
            with build_opener(NoRedirect).open(req, timeout=2) as response:
                result = json.load(response)
            if result.get("service") != "oracle-bridge":
                raise ValueError("Port 18081 is occupied by another service.")
            return True
        except URLError as error:
            if isinstance(error, HTTPError):
                raise ValueError("Port 18081 rejected the Oracle key; check the existing bridge.") from None
            return False
    if ready():
        return
    _, data = locations()
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (data / "bridge.log").open("a") as log:
        process = subprocess.Popen([sys.executable, str(ROOT / "bridge.py")], stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, start_new_session=True)
    private_write(data / "bridge.pid", str(process.pid))
    for _ in range(20):
        if ready():
            return
        if process.poll() is not None:
            break
        time.sleep(0.1)
    raise ValueError("Oracle compatibility bridge did not start; inspect ~/.local/share/oracle/bridge.log.")


def sse_events(response):
    data = []
    for line in response:
        line = line.decode("utf-8").rstrip("\r\n")
        if not line:
            if data:
                value = "\n".join(data)
                if value == "[DONE]":
                    return
                yield json.loads(value)
                data = []
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
    if data:
        value = "\n".join(data)
        if value != "[DONE]":
            yield json.loads(value)


def measure(config, tokens, prompt):
    payload = {"model": config["model"], "messages": [{"role": "user", "content": prompt}],
               "stream": True, "stream_options": {"include_usage": True}, "max_tokens": tokens,
               "temperature": 0.7, "top_p": 0.8, "top_k": 20,
               "chat_template_kwargs": {"enable_thinking": False}, "cache_prompt": False}
    start = time.perf_counter()
    first = None
    usage, timings, text, finish = {}, {}, [], None
    with request(config, "/chat/completions", payload) as response:
        for event in sse_events(response):
            if event.get("error"):
                raise ValueError("Server returned a streaming generation error.")
            usage = event.get("usage") or usage
            timings = event.get("timings") or timings
            for choice in event.get("choices", []):
                delta = choice.get("delta", {})
                content = delta.get("content", "")
                reasoning = delta.get("reasoning_content", "")
                if content or reasoning:
                    if first is None:
                        first = time.perf_counter()
                    text.append(content)
                finish = choice.get("finish_reason") or finish
    end = time.perf_counter()
    count = usage.get("completion_tokens")
    if first is None or not count:
        raise ValueError("No generated tokens or server token counts; cannot calculate an honest benchmark.")
    if finish is None:
        raise ValueError("Stream ended without a completion finish reason.")
    seconds = end - start
    return {"completion_tokens": count, "prompt_tokens": usage.get("prompt_tokens"),
            "first_token_seconds": first - start, "total_seconds": seconds,
            "end_to_end_tps": count / seconds,
            "server_generation_tps": timings.get("predicted_per_second"),
            "finish_reason": finish, "text": "".join(text)}


def benchmark(argv):
    parser = argparse.ArgumentParser(prog="oracle benchmark")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--tokens", type=int, default=384)
    parser.add_argument("--target-tps", type=float, default=30)
    parser.add_argument("--prompt-file", type=Path, help="representative repository prompt; included in token count")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if not 1 <= args.runs <= 10 or not 128 <= args.tokens <= 4096 or args.target_tps <= 0:
        raise ValueError("Use 1–10 runs, 128–4096 output tokens, and a positive target TPS.")
    config = settings()
    prompt = (args.prompt_file.read_text() if args.prompt_file else
              "Write a complete Python implementation of a bounded LRU cache, with type hints, "
              "thread safety, docstrings, and usage examples. Provide at least 150 lines of code. "
              "Start with code immediately; do not stop after an outline.")
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.output or locations()[1] / "benchmarks" / f"{stamp}.md"
    rows, failure = [], None
    try:
        for index in range(args.runs):
            row = measure(config, args.tokens, prompt + f"\nBenchmark variation {stamp}-{index}: use distinct example keys.")
            rows.append(row)
            speed = row["server_generation_tps"]
            print(f"Run {index + 1}: {row['completion_tokens']} tokens; first token {row['first_token_seconds']:.2f}s; "
                  f"end-to-end {row['end_to_end_tps']:.2f} tok/s; server generation {speed if speed else 'not supplied'}")
    except (ValueError, OSError, TimeoutError) as error:
        failure = str(error)
    supplied = [row["server_generation_tps"] for row in rows if row["server_generation_tps"]]
    enough = len(rows) == args.runs and all(row["completion_tokens"] >= 128 for row in rows)
    median = statistics.median(supplied) if len(supplied) == args.runs else None
    verdict = ("PASS" if median >= args.target_tps else "BELOW TARGET") if enough and median else "UNVERIFIED"
    lines = ["# Oracle model benchmark", "", f"UTC: {stamp}", f"Model: {config['model']}",
             f"Endpoint: {config['url']}", f"Generation target: {args.target_tps:g} tokens/second", "",
             "## Method", "", "Stream Chat Completions through the configured remote API. Thinking and prompt caching are disabled in the request. "
             "Each run uses a distinct suffix. Token counts and backend generation speed come from the server; "
             "first-token and total elapsed times use the local monotonic clock. A custom prompt may be supplied for repository-size workloads.", "",
             "## Measurements", "", "| Run | Prompt tokens | Output tokens | First token (s) | Total (s) | End-to-end tok/s | Server generation tok/s |",
             "|---|---:|---:|---:|---:|---:|---:|"]
    for i, row in enumerate(rows, 1):
        speed = row["server_generation_tps"]
        lines.append(f"| {i} | {row['prompt_tokens']} | {row['completion_tokens']} | {row['first_token_seconds']:.3f} | "
                     f"{row['total_seconds']:.3f} | {row['end_to_end_tps']:.2f} | {f'{speed:.2f}' if speed else 'not supplied'} |")
    lines.extend(["", "## Failures and limitations", "", failure or "No request errors observed.",
                  "Samples below 128 output tokens do not establish the throughput target. Backend generation speed excludes prompt processing and network latency. "
                  "These API measurements do not prove coding accuracy, agent tool execution, or performance at other context lengths.", "",
                  "## Conclusion", "", f"**{verdict}**. Median backend generation speed: {f'{median:.2f} tok/s' if median else 'unavailable'}.",
                  "", "## Assumptions and next steps", "", "The server is assumed to run the configured model; independently inspect the Pod and its logs. "
                  "Verify a real Oracle file-edit task separately. Repeat with a representative repository prompt before drawing long-context conclusions.", ""])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines))
    print(f"Report: {output}\nTarget result: {verdict}")
    return 0 if verdict == "PASS" else 1


def codex_command(argv, config):
    binary = shutil.which("codex")
    if not binary:
        raise ValueError("Codex engine is missing. Install from https://github.com/openai/codex")
    _, data = locations()
    home = data / "codex"
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    catalog = json.loads((ROOT / "catalog.json").read_text())
    model = catalog["models"][0]
    model.update(slug=config["model"], context_window=config["context"], max_context_window=config["context"],
                 auto_compact_token_limit=int(config["context"] * 0.5))
    private_write(data / "catalog.json", json.dumps(catalog))
    options = {
        "model": config["model"], "model_provider": "oracle",
        "model_catalog_json": str(data / "catalog.json"), "model_instructions_file": str(ROOT / "instructions.md"),
        "model_context_window": config["context"], "model_auto_compact_token_limit": int(config["context"] * 0.5),
        "tool_output_token_limit": 1500, "web_search": "disabled", "sandbox_mode": "workspace-write",
        "approval_policy": "on-request", "model_providers.oracle.name": "Oracle / RunPod",
        "model_providers.oracle.base_url": config["url"], "model_providers.oracle.env_key": "ORACLE_API_KEY",
        "model_providers.oracle.wire_api": "responses", "model_providers.oracle.requires_openai_auth": False,
        "model_providers.oracle.supports_websockets": False, "model_providers.oracle.request_max_retries": 1,
        "model_providers.oracle.stream_max_retries": 0, "model_providers.oracle.stream_idle_timeout_ms": 120000,
        "features.enable_request_compression": False, "features.apps": False,
        "features.multi_agent": False, "features.memories": False, "features.plugins": False,
        "features.browser_use": False, "features.computer_use": False, "features.code_mode": False,
        "features.code_mode_host": False, "features.unbounded_connection_retries": False,
        "features.skip_host_skill_discovery": True, "shell_environment_policy.ignore_default_excludes": False,
        "skills.include_instructions": False, "skills.bundled.enabled": False,
        "suppress_unstable_features_warning": True,
    }
    command = [binary, "--no-daemon"]
    for name, value in options.items():
        command.extend(["-c", name + "=" + json.dumps(value)])
    command.extend(argv)
    env = dict(os.environ)
    for name in list(env):
        if name.startswith("CODEX_") or name in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID"):
            env.pop(name)
    env.update(CODEX_HOME=str(home), ORACLE_API_KEY=api_key())
    return command, env


def help_text():
    print(f"""Oracle {VERSION} — local coding agent powered by the Codex harness

  oracle                         Start an interactive coding session
  oracle \"fix the failing test\"  Start with a task
  oracle exec \"task\"            Run a task non-interactively
  oracle resume --last           Resume your last Oracle session
  oracle configure --url URL --key-file PATH
  oracle doctor [--chat]         Check engine, authentication, and model API
  oracle connect                Reconnect the saved SSH tunnel
  oracle disconnect             Close only Oracle's local tunnel
  oracle benchmark [--runs 3] [--tokens 384] [--prompt-file PATH]
  oracle engine-help             Show all upstream Codex options

Configuration: {locations()[0]}
Session state: {locations()[1] / 'codex'}
Oracle uses your model server key, independently of ChatGPT login.
The upstream Codex terminal interface remains visible in this first version.""")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        if argv and argv[0] in ("-h", "--help", "help"):
            help_text()
            return 0
        if argv and argv[0] in ("-V", "--version"):
            print(f"oracle {VERSION}")
            return 0
        handlers = {"configure": configure, "doctor": doctor, "benchmark": benchmark, "connect": tunnel,
                    "disconnect": lambda args: tunnel(args, disconnect=True)}
        if argv and argv[0] in handlers:
            return handlers[argv[0]](argv[1:])
        if argv and argv[0] == "engine-help":
            return subprocess.call([shutil.which("codex") or "codex", "--help"])
        config = settings()
        command, env = codex_command(argv, config)
        if sys.stderr.isatty():
            print(f"Oracle · {config['model']} · {config['url']}", file=sys.stderr)
        os.execvpe(command[0], command, env)
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        print(f"oracle: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
