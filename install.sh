#!/bin/sh
set -eu

command -v node >/dev/null 2>&1 || { echo 'Node.js 20.19+ is required. Install Node.js, then rerun this command.' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'npm is required. Install Node.js with npm, then rerun this command.' >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<20 || major===20 && minor<19) process.exit(1)' || { echo 'Node.js 20.19+ is required.' >&2; exit 1; }

release_version=${BISMYTH_TUI_VERSION:-0.1.3}
install_prefix=${BISMYTH_INSTALL_PREFIX:-"$HOME/.local"}
case "$release_version" in ''|*[!0-9A-Za-z.-]*) echo 'Invalid release version.' >&2; exit 1;; esac
release_url="https://github.com/aansh-afk/bismyth-lead-tui/releases/download/v${release_version}/bismyth-lead-tui-${release_version}.tgz"

npm install --global --prefix "$install_prefix" "$release_url"
echo
echo "Installed bismyth-leads ${release_version}."
case ":$PATH:" in
  *":$install_prefix/bin:"*) echo 'Run: bismyth-leads';;
  *) echo "Run: $install_prefix/bin/bismyth-leads"
     echo "To use the short command, add $install_prefix/bin to your PATH.";;
esac
if ! command -v codex >/dev/null 2>&1; then
  echo 'AI setup: npm install -g @openai/codex'
  echo 'Then: codex login (choose Sign in with ChatGPT)'
fi
echo 'Chrome/Chromium must also be installed. Check setup with: bismyth-leads doctor'
