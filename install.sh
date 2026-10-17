#!/bin/sh
set -eu

if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; then
  for candidate in "$HOME"/.nvm/versions/node/v24*/bin/node; do
    if [ -x "$candidate" ]; then
      PATH="$(dirname "$candidate"):$PATH"
      export PATH
      break
    fi
  done
fi
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1 || { echo 'Node.js 24+ is required. Install it, then rerun this command.' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo 'Python 3.11+ with curses is required.' >&2; exit 1; }
python3 -c 'import curses,sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' || { echo 'Python 3.11+ with curses is required.' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'npm is required.' >&2; exit 1; }

release_version=${BISMYTH_TUI_VERSION:-0.2.1}
install_prefix=${BISMYTH_INSTALL_PREFIX:-"$HOME/.local"}
case "$release_version" in ''|*[!0-9A-Za-z.-]*) echo 'Invalid release version.' >&2; exit 1;; esac
release_url="https://github.com/aansh-afk/bismyth-lead-tui/releases/download/v${release_version}/bismyth-lead-tui-${release_version}.tgz"
npm install --global --prefix "$install_prefix" "$release_url"
echo "Installed Oracle Leads ${release_version}. Run: $install_prefix/bin/bismyth-leads"
if ! command -v codex >/dev/null 2>&1; then
  echo 'For subscription inference: install Codex CLI, then run codex login and choose Sign in with ChatGPT.'
fi
echo 'Your existing contacts, credentials and saved runs were not moved. Import older Bismyth contacts from page 3 with L.'
