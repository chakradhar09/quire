#!/usr/bin/env bash
# Updates Quire to its latest release; your drafts, reports and settings (app/data) are kept. When a release
# tag is newer than this copy: stops Quire, switches to it, reinstalls the worker's and the app's packages,
# rebuilds, and starts Quire again if it was running. --quiet prints only what changed (used by the launcher).
set -euo pipefail
APP="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/.." && pwd)"
QUIET=0; FORCE=0
for a in "$@"; do case "$a" in --quiet) QUIET=1 ;; --force) FORCE=1 ;; esac; done

if ! git -C "$APP" fetch --quiet --tags; then
  [ "$QUIET" = 1 ] || echo "Could not reach the update server; try again later."; exit 0
fi
latest="$(git -C "$APP" tag --list 'v*' --sort=-v:refname | head -1)"
# The release this copy is on: its tag, or else the version in package.json (a copy between releases).
current="$(git -C "$APP" describe --tags --exact-match 2>/dev/null || echo "v$("$APP/worker/.venv/bin/python" -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$APP/web/package.json")")"
# Version numbers as one integer with awk (macOS's sort has no -V before macOS 13); pre-release suffixes dropped.
ver() { echo "${1%%-*}" | awk -F. '{ printf "%d%03d%03d\n", $1, $2, $3 }'; }
if [ -z "$latest" ] || { [ "$FORCE" = 0 ] && [ "$(ver "${latest#v}")" -le "$(ver "${current#v}")" ]; }; then
  [ "$QUIET" = 1 ] || echo "Quire $current is the latest release."; exit 0
fi

echo "==> Updating Quire $current to $latest"
was_running=0; [ -f "$APP/data/web.pid" ] && was_running=1
"$APP/scripts/quire.sh" --stop >/dev/null
git -C "$APP" checkout --quiet "$latest"
# ponytail: PyTorch itself is not reinstalled here; a release that moves it says to run the installer again.
"$APP/worker/.venv/bin/python" -m pip install --quiet -r "$APP/worker/requirements.txt"
(cd "$APP/web" && npm ci --no-audit --no-fund --loglevel=error && npm run build)
echo "==> Quire is now $latest"
if [ "$was_running" = 1 ] && [ "$QUIET" = 0 ]; then "$APP/scripts/quire.sh"; fi
