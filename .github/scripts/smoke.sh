#!/usr/bin/env bash
# CI, after scripts/install.sh: opens Quire, uploads a draft, checks that the worker starts and reads it, stops
# Quire, checks that the app and the worker are gone, then uninstalls. Usage: smoke.sh INSTALL_DIR
set -euo pipefail
DIR="$1"; APP="$DIR/app"; DATA="$APP/data"; URL="http://127.0.0.1:3000"
export QUIRE_NO_BROWSER=1

echo "::group::Open Quire"
"$APP/scripts/quire.sh"
curl -fsS -o /dev/null "$URL/"
echo "::endgroup::"

echo "::group::Upload a draft"
draft="$(mktemp -d)/draft.txt"
printf 'A short draft with a few sentences of plain prose in it.\nEnough for the worker to read and queue.\n' >"$draft"
curl -fsS -o /dev/null -H "Origin: $URL" -F title=CI -F "file=@$draft" "$URL/api/upload"
curl -fsS -o /dev/null "$URL/drafts"  # a page with drafts queued starts the worker (components/worker-light.tsx)
for _ in $(seq 60); do grep -qs "extract (document 1): done" "$DATA/worker.log" && break; sleep 1; done
cat "$DATA/worker.log"
grep -q "extract (document 1): done" "$DATA/worker.log"
worker="$(cat "$DATA/worker.pid")"
echo "::endgroup::"

echo "::group::Stop Quire"
"$APP/scripts/quire.sh" --stop
for _ in $(seq 20); do kill -0 "$worker" 2>/dev/null || break; sleep 1; done
if kill -0 "$worker" 2>/dev/null; then echo "::error::The worker is still running after quire --stop"; exit 1; fi
if curl -fs -o /dev/null "$URL/"; then echo "::error::The app still answers after quire --stop"; exit 1; fi
echo "::endgroup::"

echo "::group::Uninstall"
QUIRE_YES=1 QUIRE_KEEP_DATA=0 "$APP/scripts/uninstall.sh"
if [ -e "$DIR" ]; then echo "::error::$DIR is still there after uninstalling"; exit 1; fi
echo "::endgroup::"
