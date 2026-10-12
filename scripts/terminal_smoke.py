"""Exercise the real TUI through a pseudo-terminal without contacting any portal."""
import fcntl
import json
import os
import pty
import re
import select
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="bismyth-terminal-") as directory:
    Path(directory, 'config.json').write_text(json.dumps({'seedUrls': ['https://www.99acres.com/fixture-npxid-1']}))
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 100, 0, 0))
    environment = {**os.environ, "BISMYTH_TUI_DATA": directory, "TERM": "xterm-256color"}
    process = subprocess.Popen(["node", "launch.mjs"], cwd=root, env=environment,
                               stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)

    def read_for(seconds=0.5):
        result = b""
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if select.select([master], [], [], max(0, end - time.monotonic()))[0]:
                try:
                    result += os.read(master, 65536)
                except OSError:
                    break
        return result.decode("utf-8", errors="replace")

    try:
        startup = read_for(0.5)
        deadline = time.monotonic() + 12
        while ('State / UT' not in startup or 'ChatGPT subscription connected' not in startup) and time.monotonic() < deadline:
            startup += read_for(0.3)
        assert "enquiry desk" in startup and "State / UT" in startup, startup
        assert "ChatGPT subscription connected" in startup, startup
        if os.environ.get('BISMYTH_TUI_CAPTURE'):
            Path(os.environ['BISMYTH_TUI_CAPTURE']).write_text(startup)
        os.write(master, b"\rMaharashtra\r")
        read_for()
        assert json.loads(Path(directory, "config.json").read_text())["stateCode"] == "MH"
        os.write(master, b"\rPune\r")
        edited = read_for()
        assert "City selected: Pune" in edited, edited
        assert json.loads(Path(directory, "config.json").read_text())["city"] == "Pune"
        os.write(master, b"a")
        advanced = read_for()
        assert 'Advanced settings' in advanced and 'Import URL file' in advanced
        os.write(master, b"a")
        read_for()
        os.write(master, b"i")
        imported = read_for()
        assert 'fixture-npxid-1' in imported
        os.write(master, b"\r")
        review = read_for()
        assert 'Choose how to run this queue' in review and 'Test forms' in review and 'Send enquiries' in review
        if os.environ.get('BISMYTH_TUI_CAPTURE'):
            Path(os.environ['BISMYTH_TUI_CAPTURE'] + '.review').write_text(review)
        os.write(master, b"\x1b")
        # Node's key parser waits briefly to distinguish Escape from an Alt sequence.
        read_for(0.9)
        os.write(master, b"2n")
        queue = read_for()
        assert "New empty run created" in queue, queue
        os.write(master, b"4f")
        history = read_for()
        assert "Pune" in history and "ready" in history, history
        os.write(master, b"\r")
        read_for()
        os.write(master, b"x")
        exported = read_for()
        assert "Exported:" in exported, exported
        assert list(Path(directory).glob("*.csv"))
        # Resize and check that the app redraws rather than crashing.
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 80, 0, 0))
        os.write(master, b"1?")
        help_text = read_for()
        assert "Keyboard guide" in help_text, help_text
        os.write(master, b"q")
        exit_text = read_for()
        process.wait(timeout=10)
        assert process.returncode == 0, process.returncode
        assert "\x1b[?1049l" in exit_text and "\x1b[?25h" in exit_text
        assert not Path(directory, "session.lock").exists()
        print("PASS: subscription indicator, profile edit/save, advanced toggle, import/review modal, queue, history/load, CSV export, resize, help, clean exit")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)

# Exercise the real timer and key parser with a deliberately slow preview driver.
# Every browser method used by this scenario is replaced before the launcher loads;
# these delays never open Chrome, call a model, or contact a property portal.
with tempfile.TemporaryDirectory(prefix="bismyth-animation-") as directory:
    Path(directory, "config.json").write_text(json.dumps({
        "stateCode": "MH", "city": "Pune", "intent": "buy",
        "name": "Fixture User", "email": "fixture@example.test", "phone": "+91 9000000000",
        "sites": ["99acres"], "limit": 1, "delayMs": 0, "mode": "preview",
        "seedUrls": ["https://www.99acres.com/fixture-npxid-1"],
    }))
    launcher = """
        import {setTimeout as sleep} from 'node:timers/promises';
        import {PortalBrowser} from './dist/browser.js';
        import {project} from './dist/model.js';
        let preparation = 0;
        PortalBrowser.prototype.discover = async function (config, site, limit, checkpoint) {
            await sleep(1800); await checkpoint();
            return [project(site, 'Animation fixture', 'https://www.99acres.com/fixture-npxid-1')];
        };
        PortalBrowser.prototype.prepare = async function () {
            preparation++;
            await sleep(preparation === 1 ? 3200 : 1000);
            return {ready: preparation !== 1, reason: 'Fixture browser step', baseline: []};
        };
        PortalBrowser.prototype.submit = async function () { throw new Error('Fixture must never submit'); };
        PortalBrowser.prototype.confirmed = async function () { throw new Error('Fixture must never verify a live enquiry'); };
        PortalBrowser.prototype.close = async function () {};
        await import('./launch.mjs');
    """
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
    environment = {**os.environ, "BISMYTH_TUI_DATA": directory, "TERM": "xterm-256color"}
    process = subprocess.Popen(["node", "--input-type=module", "-e", launcher], cwd=root,
                               env=environment, stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)

    def read_for(seconds=0.5):
        result = b""
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if select.select([master], [], [], max(0, end - time.monotonic()))[0]:
                try:
                    result += os.read(master, 65536)
                except OSError:
                    break
        return result.decode("utf-8", errors="replace")

    def wait_for(text, timeout=8):
        result = ""
        deadline = time.monotonic() + timeout
        while text not in result and time.monotonic() < deadline:
            result += read_for(0.15)
        assert text in result, result
        return result

    def frames(text):
        return set(re.findall(r"[\u2800-\u28ff]", text))

    try:
        wait_for("Start a property enquiry run")
        os.write(master, b"\x12")  # Ctrl+R discovers when there is no queue.
        finding = wait_for("Finding properties") + read_for(0.6)
        assert len(frames(finding)) >= 2, finding
        assert re.search(r"\d+:\d{2}", finding), finding
        wait_for("Properties found")

        os.write(master, b"2\r")  # Review queue + Enter opens the run choices.
        review = wait_for("Choose how to run this queue")
        assert "Test forms" in review, review
        os.write(master, b"\r")
        working = wait_for("Testing forms") + read_for(0.6)
        assert len(frames(working)) >= 2, working

        os.write(master, b"p")
        wait_for("Paused")
        paused = read_for(0.55)
        assert not frames(paused), paused
        os.write(master, b"\r")  # Enter resumes a paused run.
        resumed = wait_for("Testing forms") + read_for(0.5)
        assert len(frames(resumed)) >= 2, resumed

        waiting = wait_for("Needs you in Chrome")
        assert "Fixture browser step" in waiting, waiting
        assert not frames(read_for(0.3)), "Waiting for user must not animate as active work"
        os.write(master, b"p")
        wait_for("Paused")
        os.write(master, b"\r")  # Resume first; the browser prompt still needs its answer.
        resumed_handoff = wait_for("Needs you in Chrome")
        assert "Run finished" not in resumed_handoff and not frames(resumed_handoff), resumed_handoff
        os.write(master, b"\r")  # Enter continues the browser handoff.
        finished = wait_for("Run finished")
        assert "1 forms tested" in finished, finished
        read_for(0.25)  # Drain the final saved-run refresh.
        assert read_for(0.45) == "", "Finished runs must not keep redrawing"

        # Stop another delayed preview to exercise timer cleanup while work is active.
        os.write(master, b"\x12")
        wait_for("Choose how to run this queue")
        os.write(master, b"\r")
        wait_for("Testing forms")
        os.write(master, b"s")
        stopping = wait_for("Stopping")
        if "Stopped; progress saved." not in stopping:
            wait_for("Stopped; progress saved.")
        os.write(master, b"q")
        exit_text = read_for()
        process.wait(timeout=10)
        assert process.returncode == 0, process.returncode
        assert "\x1b[?1049l" in exit_text and "\x1b[?25h" in exit_text, exit_text
        assert not Path(directory, "session.lock").exists()
        print("PASS: animated discovery/form waits, elapsed time, Review queue/Enter and Ctrl+R shortcuts, pause/Enter resume, paused handoff/Enter priority, browser handoff/Enter continue, idle completion, stop cleanup, clean exit")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
