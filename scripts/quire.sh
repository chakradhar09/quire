#!/usr/bin/env bash
# Opens Quire: starts the app in the background (if it isn't running) and opens it in your browser. With
# "autoUpdate": true in data/settings.json it first installs a newer release, if there is one. The worker
# starts by itself when there is something to check. `quire --stop` stops the app and the worker.
set -euo pipefail
# Next.js reports anonymous usage to Vercel by default; Quire sends nothing but its searches and update check.
export NEXT_TELEMETRY_DISABLED=1
APP="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0")")/.." && pwd)"
# A Node.js the installer put beside the app comes first.
if [ -d "$APP/../node/bin" ]; then PATH="$APP/../node/bin:$PATH"; fi
DATA="$APP/data"; URL="http://127.0.0.1:3000"; PID_FILE="$DATA/web.pid"
# A pid file is trusted only while it is current: after a crash or a reboot the number in it may belong to another
# program by now, which --stop must not kill. The app's counts while the app answers (or in its first minute, while
# it starts), the worker's while the worker keeps touching it (every 15 s, worker/main.py).
age() { echo $(( $(date +%s) - $(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1") )); }
running() { # running PIDFILE FRESH_SECONDS [URL]
  { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; } || return 1
  [ "$(age "$1")" -lt "$2" ] || { [ -n "${3:-}" ] && curl -fs -o /dev/null --max-time 3 "$3"; }
}
app_running() { running "$PID_FILE" 60 "$URL"; }
# The app and the worker each run as their own process group (setsid, and Node's detached): stop the whole group.
stop() { kill -- "-$(cat "$1")" 2>/dev/null || kill "$(cat "$1")" 2>/dev/null || true; }

if [ "${1:-}" = "--stop" ]; then
  was_up=0
  if app_running; then was_up=1; stop "$PID_FILE"; fi
  if running "$DATA/worker.pid" 120; then stop "$DATA/worker.pid"; fi
  rm -f "$PID_FILE" "$DATA/worker.pid"
  # Without setsid (macOS) npm's child, Next, outlives npm: stop what still listens on Quire's port, but only when
  # Quire was running there (another program may use port 3000).
  if [ "$was_up" = 1 ] && command -v lsof >/dev/null; then lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill 2>/dev/null || true; fi
  echo "Quire stopped."; exit 0
fi

mkdir -p "$DATA"
if ! app_running && grep -qs '"autoUpdate": *true' "$DATA/settings.json"; then
  "$APP/scripts/update.sh" --quiet || true
fi
if ! app_running; then
  # The database: created on the first start, and brought up to date after an update. The app only reads it,
  # and the worker that would also do this starts only once there is work in it.
  "$APP/worker/.venv/bin/python" "$APP/db/migrate.py" >/dev/null 2>&1 || true
  cd "$APP/web"
  if command -v setsid >/dev/null; then setsid npm run start >"$DATA/web.log" 2>&1 &
  else npm run start >"$DATA/web.log" 2>&1 & fi
  echo $! >"$PID_FILE"
  for _ in $(seq 60); do curl -fs -o /dev/null "$URL" && break; sleep 1; done
fi
if [ "$(uname)" = Darwin ]; then open "$URL"; else xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your browser."; fi
