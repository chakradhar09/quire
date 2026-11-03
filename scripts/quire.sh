#!/usr/bin/env bash
# Opens Quire: starts the app in the background (if it isn't running) and opens it in your browser. With
# "autoUpdate": true in data/settings.json it first installs a newer release, if there is one. The worker
# starts by itself when there is something to check. `quire --stop` stops the app and the worker.
set -euo pipefail
APP="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/.." && pwd)"
# A Node.js the installer put beside the app comes first.
if [ -d "$APP/../node/bin" ]; then PATH="$APP/../node/bin:$PATH"; fi
DATA="$APP/data"; URL="http://127.0.0.1:3000"; PID_FILE="$DATA/web.pid"
running() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

if [ "${1:-}" = "--stop" ]; then
  for f in "$PID_FILE" "$DATA/worker.pid"; do
    # The app runs as its own process group where setsid exists (Linux): stop the whole group.
    if running "$f"; then kill -- "-$(cat "$f")" 2>/dev/null || kill "$(cat "$f")" 2>/dev/null || true; fi
    rm -f "$f"
  done
  # Without setsid (macOS) npm's child, Next, outlives npm: stop whatever still listens on Quire's port.
  if command -v lsof >/dev/null; then lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill 2>/dev/null || true; fi
  echo "Quire stopped."; exit 0
fi

mkdir -p "$DATA"
if ! running "$PID_FILE" && grep -qs '"autoUpdate": *true' "$DATA/settings.json"; then
  "$APP/scripts/update.sh" --quiet || true
fi
if ! running "$PID_FILE"; then
  cd "$APP/web"
  if command -v setsid >/dev/null; then setsid npm run start >"$DATA/web.log" 2>&1 &
  else npm run start >"$DATA/web.log" 2>&1 & fi
  echo $! >"$PID_FILE"
  for _ in $(seq 60); do curl -fs -o /dev/null "$URL" && break; sleep 1; done
fi
if [ "$(uname)" = Darwin ]; then open "$URL"; else xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your browser."; fi
