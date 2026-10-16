"""Exercise recipient selection through the real launcher, with private synthetic data."""
import argparse
import fcntl
import hashlib
import json
import os
import pty
import select
import shlex
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--command", default="node launch.mjs")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]


def contact(number):
    return {
        "id": hashlib.sha256(("phone:" + number).encode()).hexdigest()[:24],
        "kind": "phone", "value": number, "raw": number, "role": "broker",
        "name": "Synthetic Broker", "review": "approved", "whatsapp": "unchecked",
        "sourceUrl": "https://example.test/listing", "evidence": "Synthetic broker: " + number,
        "observedAt": "2026-10-16T00:00:00.000Z",
    }


with tempfile.TemporaryDirectory(prefix="bismyth-recipient-pty-") as temporary:
    directory = Path(temporary)
    runs = directory / "runs"
    runs.mkdir()
    config = {
        "stateCode": "MH", "city": "Mumbai", "intent": "buy", "name": "Synthetic Sender",
        "email": "synthetic@example.test", "phone": "+919000000000", "sites": ["housing"],
        "limit": 100, "delayMs": 0, "mode": "preview", "senderBusiness": "Fixture Business",
    }
    (directory / "config.json").write_text(json.dumps(config))
    first, second = contact("+919000000001"), contact("+919000000002")
    ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]
    for index, run_id in enumerate(ids):
        at = f"2026-10-{16-index}T00:00:00.000Z"
        body = {
            "version": 1, "id": run_id, "createdAt": at, "updatedAt": at,
            "config": config, "state": "complete", "events": [], "projects": [{
                "id": "synthetic-listing", "site": "housing", "title": "Synthetic listing",
                "url": "https://housing.com/synthetic-listing", "status": "prepared", "detail": "Synthetic",
                "updatedAt": at, "contactCapture": {"status": "captured", "attemptedAt": at,
                    "detail": "Synthetic public contacts", "contacts": [first, second]},
            }],
        }
        (runs / (run_id + ".json")).write_text(json.dumps(body))
    stub = directory / "bin"
    stub.mkdir()
    codex = stub / "codex"
    codex.write_text("#!/bin/sh\n[ \"$1\" = login ] && [ \"$2\" = status ] || exit 1\nprintf 'Logged in using ChatGPT\\n'\n")
    codex.chmod(0o700)
    environment = {**os.environ, "BISMYTH_TUI_DATA": str(directory), "TERM": "xterm-256color",
                   "PATH": str(stub) + os.pathsep + os.environ.get("PATH", "")}
    for name in ["FIRECRAWL_API_KEY", "BISMYTH_WHATSAPP_ROUTER_URL", "BISMYTH_WHATSAPP_ROUTER_API_KEY", "BISMYTH_WHATSAPP_SESSION_ID"]:
        environment.pop(name, None)

    def saved(index=0):
        return json.loads((runs / (ids[index] + ".json")).read_text())

    def launch():
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        process = subprocess.Popen(shlex.split(args.command), cwd=root, env=environment,
                                   stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        return process, master

    def read_for(master, seconds=0.3):
        result = b""
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if select.select([master], [], [], max(0, end-time.monotonic()))[0]:
                try:
                    result += os.read(master, 65536)
                except OSError:
                    break
        return result.decode("utf-8", errors="replace")

    def press(master, keys):
        os.write(master, keys)
        # Node waits up to 500 ms to distinguish Escape from an Alt sequence.
        return read_for(master, 0.9 if keys == b"\x1b" else 0.3)

    def wait_for(master, text, timeout=20):
        output = ""
        deadline = time.monotonic() + timeout
        while text not in output and time.monotonic() < deadline:
            output += read_for(master, 0.2)
        assert text in output, output[-6000:]
        return output

    def stop(process, master):
        try:
            output = press(master, b"q")
            process.wait(timeout=8)
            assert process.returncode == 0, (process.returncode, output)
            assert "\x1b[?1049l" in output
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            os.close(master)

    process, master = launch()
    try:
        wait_for(master, "Atlas lead desk")
        saved_view = press(master, b"4")
        assert "Choose recipients" in saved_view, saved_view
        picker = press(master, b"w")
        assert "0 selected" in picker and "Only checked recipients" in picker, picker
        empty = press(master, b"\r")
        assert "Select approved phone contacts" in empty and "Review WhatsApp introduction" not in empty
        checked = press(master, b" ")
        assert "1 selected" in checked, checked
        assert saved()["outreachSelection"]["contactIds"] == [first["id"]]
        press(master, b"\x1b[B")
        review = press(master, b"\r")
        assert "1 recipients: " + first["value"] in review, review
        assert "Preview only" in review, review
        cancelled = press(master, b"\x1b")
        assert "Contacts → Atlas outreach" in cancelled and "Review WhatsApp introduction" not in cancelled, cancelled
        press(master, b"4")
        press(master, b"\x1b[B")
        other = press(master, b"w")
        assert "0 selected" in other, other
        assert "outreachSelection" not in saved(1)
        press(master, b"4")
        press(master, b"\x1b[A")
        restored = press(master, b"w")
        assert "1 selected" in restored, restored
        assert saved()["outreachSelection"]["contactIds"] == [first["id"]]
    finally:
        stop(process, master)

    process, master = launch()
    try:
        wait_for(master, "Atlas lead desk")
        press(master, b"4")
        assert "1 selected" in press(master, b"w")
        assert "2 selected" in press(master, b"b")
        assert set(saved()["outreachSelection"]["contactIds"]) == {first["id"], second["id"]}
        assert "0 selected" in press(master, b"z")
        assert saved()["outreachSelection"]["contactIds"] == []
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        compact = press(master, b"5")
        assert "Space Toggle" in compact and "Z Clear" in compact, compact
        assert not (directory / "outreach.json").exists(), "selection must not create sends"
        assert saved()["projects"][0]["status"] == "prepared"
        assert "outreachSelection" not in saved(1)
    finally:
        stop(process, master)
    assert not (directory / "session.lock").exists()
    print("PASS: saved-run picker, empty Enter, Space persistence, unchecked focus exclusion, preview default, run isolation, restart, select-all/clear, compact controls, clean exit; no sends or external requests")
