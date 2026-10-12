"""Exercise the real TUI through a pseudo-terminal without contacting any portal."""
import fcntl
import json
import os
import pty
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
