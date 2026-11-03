#!/usr/bin/env bash
# Removes Quire from macOS or Linux: stops it, then deletes what the installer made: the app, the private Python
# and Node.js (if it installed them), the quire, quire-update and quire-uninstall commands and the desktop entry.
# First it asks whether to keep your drafts, reports and settings (app/data); kept, they move to ~/Quire-data-<date>.
# Git, Homebrew and anything else installed system-wide stay.
#
#   quire-uninstall
#   curl -fsSL https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/uninstall.sh | bash
#
# Options (environment variables): QUIRE_DIR (default ~/.quire), QUIRE_YES=1 (no questions; keeps your data),
# QUIRE_KEEP_DATA=0 or 1 (answers the data question).
set -euo pipefail

say() { printf '\033[32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !\033[0m %s\n' "$*"; }
ask() { # ask "question" default
  # No terminal to ask in (QUIRE_YES, or no /dev/tty that opens, as under CI or some containers): the default.
  if [ "${QUIRE_YES:-}" = 1 ] || ! { : </dev/tty; } 2>/dev/null; then echo "$2"; return; fi
  local answer; read -r -p "$1 " answer </dev/tty || true; echo "${answer:-$2}"
}

# All in a function, so bash has read the whole script before it deletes the folder this file is in.
main() {
  local self dir app keep dest n f link
  # Run from an install (quire-uninstall), the install is the one it is in; piped from curl, QUIRE_DIR or ~/.quire.
  self="${BASH_SOURCE[0]:-}"
  if [ -z "${QUIRE_DIR:-}" ] && [ -f "$self" ]; then
    self="$(readlink -f "$self" 2>/dev/null || realpath "$self")"
    dir="$(cd "$(dirname "$self")/../.." && pwd)"
  else
    dir="${QUIRE_DIR:-$HOME/.quire}"
  fi
  app="$dir/app"
  if [ ! -f "$app/scripts/quire.sh" ] || [ ! -d "$app/.git" ]; then
    warn "There is no Quire install in $dir. (Installed elsewhere? Run it with QUIRE_DIR set to that folder.)"
    exit 1
  fi

  say "This removes Quire from $dir"
  if [ "${QUIRE_YES:-}" != 1 ]; then
    case "$(ask "  Remove Quire? [y/N]" n)" in [yY]*) ;; *) echo "Nothing was removed."; exit 0 ;; esac
  fi
  keep="${QUIRE_KEEP_DATA:-}"
  if [ -z "$keep" ] && [ -d "$app/data" ]; then
    case "$(ask "  Keep your drafts, reports and settings (they move to your home folder)? [Y/n]" y)" in [nN]*) keep=0 ;; *) keep=1 ;; esac
  fi

  say "Stopping Quire"
  "$app/scripts/quire.sh" --stop >/dev/null 2>&1 || true

  if [ "$keep" != 0 ] && [ -d "$app/data" ]; then
    dest="$HOME/Quire-data-$(date +%Y-%m-%d)"; n=2
    while [ -e "$dest" ]; do dest="$HOME/Quire-data-$(date +%Y-%m-%d)-$n"; n=$((n + 1)); done
    # The AI-writing model (about 575 MB) and the logs aren't yours: the installer downloads the model again.
    rm -rf "$app/data/calibration/classifier/model"
    rmdir "$app/data/calibration/classifier" "$app/data/calibration" 2>/dev/null || true
    rm -f "$app/data/web.pid" "$app/data/worker.pid" "$app/data/web.log" "$app/data/worker.log"
    mv "$app/data" "$dest"
    say "Your drafts, reports and settings are in $dest"
    echo "    To use them again: install Quire, run quire --stop, put that folder in place of $app/data,"
    echo "    and run the installer once more (it downloads the AI-writing model again)."
  fi

  # The commands and the desktop entry, but only the ones that belong to this install.
  for f in quire quire-update quire-uninstall; do
    link="$HOME/.local/bin/$f"
    if [ -L "$link" ]; then case "$(readlink "$link")" in "$app"/*) rm -f "$link" ;; esac; fi
  done
  f="$HOME/.local/share/applications/quire.desktop"
  if [ -f "$f" ] && grep -qF "Exec=$app/" "$f"; then rm -f "$f"; fi

  say "Deleting the app"
  # Only what the installer made, never the whole folder: QUIRE_DIR may have been one with other things in it.
  rm -rf "$app" "$dir/node" "$dir/python" "$dir/uv"
  rmdir "$dir" 2>/dev/null || warn "$dir still has other files in it; they were left alone."
  say "Quire is removed."
}

main "$@"
exit
