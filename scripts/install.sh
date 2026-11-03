#!/usr/bin/env bash
# Installs Quire on macOS or Linux: the app, its Python worker, the AI-writing model, and a `quire` command.
#
#   curl -fsSL https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/install.sh | bash
#
# Needs Git, Node.js 22.13+ and Python 3.11 or 3.12 (it says how to get any that are missing). Everything goes into one
# folder (default ~/.quire): the code in app/, your drafts and the database in app/data/. Run it again to repair
# an install; run `quire-update` to update.
#
# Options (environment variables): QUIRE_DIR, QUIRE_SOURCE (git URL or folder), BRAVE_API_KEY, QUIRE_CPU=1 (CPU
# PyTorch even with an NVIDIA GPU), QUIRE_NO_MODEL=1, QUIRE_YES=1 (accept every default).
set -euo pipefail

# Kept in step with scripts/install.ps1, web/lib/updates.ts (REPO) and MODEL.md.
REPO="chakradhar09/quire"
TORCH_VERSION="2.14.1"
MODEL_URL="https://github.com/$REPO/releases/download/model-v5/quire-classifier-v5.zip"
DIR="${QUIRE_DIR:-$HOME/.quire}"
SOURCE="${QUIRE_SOURCE:-https://github.com/$REPO.git}"
APP="$DIR/app"

say() { printf '\033[32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !\033[0m %s\n' "$*"; }
ask() { # ask "question" default
  if [ "${QUIRE_YES:-}" = 1 ] || { [ ! -t 0 ] && [ ! -e /dev/tty ]; }; then echo "$2"; return; fi
  local answer; read -r -p "$1 " answer </dev/tty || true; echo "${answer:-$2}"
}
# at_least "have" "want": version comparison with awk (macOS's sort has no -V before macOS 13).
ver() { echo "$1" | awk -F. '{ printf "%d%03d%03d\n", $1, $2, $3 }'; }
at_least() { [ "$(ver "$1")" -ge "$(ver "$2")" ]; }

# Python 3.11 or 3.12: the OCR package has no build for 3.13 or later yet.
good_python() { "$1" -c 'import sys; sys.exit(not (3, 11) <= sys.version_info[:2] < (3, 13))' 2>/dev/null; }
# What is missing, as Homebrew formulae (a plain string: macOS's bash 3.2 trips on empty arrays under set -u);
# also finds the Python to use ($PY).
find_missing() {
  missing=""
  command -v git >/dev/null || missing="$missing git"
  if ! command -v node >/dev/null || ! at_least "$(node --version | tr -d v)" 22.13.0; then missing="$missing node"; fi
  PY=""
  for candidate in python3.12 python3.11 python3 python; do
    if command -v "$candidate" >/dev/null && good_python "$candidate"; then PY="$candidate"; break; fi
  done
  [ -n "$PY" ] || missing="$missing python@3.12"
}

say "Checking for Git, Node.js and Python"
find_missing
if [ -n "$missing" ] && [ "$(uname)" = Darwin ] && command -v brew >/dev/null; then
  warn "Quire needs:$missing."
  case "$(ask "  Install them now with Homebrew? [Y/n]" y)" in
    [yY]*) brew install $missing && find_missing ;;  # unquoted on purpose: one formula per word
  esac
fi
if [ -n "$missing" ]; then
  warn "Quire still needs:$missing (Node.js 22.13 or later, Python 3.11 or 3.12)."
  if [ "$(uname)" = Darwin ]; then warn "Install Homebrew from brew.sh, then: brew install$missing"
  else warn "With your package manager, e.g.: sudo apt install git python3.12 python3.12-venv; Node.js 22 from nodejs.org or nvm."; fi
  warn "Then run the installer again."
  exit 1
fi

mkdir -p "$DIR"
if [ -d "$APP/.git" ]; then
  say "Quire is already in $APP; repairing it in place (run quire-update to update)"
else
  say "Downloading Quire into $APP"
  git clone --quiet "$SOURCE" "$APP"
  tag="$(git -C "$APP" tag --list 'v*' --sort=-v:refname | head -1)"
  if [ -n "$tag" ]; then git -C "$APP" checkout --quiet "$tag"; say "Using release $tag"; fi
fi

say "Setting up the worker's Python environment (this downloads PyTorch, a few hundred MB to 2.5 GB)"
if [ -x "$APP/worker/.venv/bin/python" ] && ! good_python "$APP/worker/.venv/bin/python"; then rm -rf "$APP/worker/.venv"; fi
[ -x "$APP/worker/.venv/bin/python" ] || "$PY" -m venv "$APP/worker/.venv"
VPY="$APP/worker/.venv/bin/python"
"$VPY" -m pip install --quiet --upgrade pip
if [ "$(uname)" = Darwin ]; then
  say "PyTorch $TORCH_VERSION (Apple silicon GPUs included)"
  "$VPY" -m pip install --quiet "torch==$TORCH_VERSION"
elif [ "${QUIRE_CPU:-}" != 1 ] && command -v nvidia-smi >/dev/null; then
  say "PyTorch $TORCH_VERSION for your NVIDIA GPU"
  "$VPY" -m pip install --quiet "torch==$TORCH_VERSION" --index-url https://download.pytorch.org/whl/cu130
else
  say "PyTorch $TORCH_VERSION for the CPU"
  "$VPY" -m pip install --quiet "torch==$TORCH_VERSION" --index-url https://download.pytorch.org/whl/cpu
fi
"$VPY" -m pip install --quiet -r "$APP/worker/requirements.txt"

say "Building the app"
(cd "$APP/web" && npm ci --no-audit --no-fund --loglevel=error && npm run build)

ENV_FILE="$APP/worker/.env"
[ -f "$ENV_FILE" ] || cp "$APP/worker/.env.example" "$ENV_FILE"
set_env() { # set_env KEY VALUE
  if grep -q "^$1=" "$ENV_FILE"; then
    "$VPY" - "$ENV_FILE" "$1" "$2" <<'PY'
import sys, pathlib
path, key, value = sys.argv[1:]
p = pathlib.Path(path)
p.write_text("".join(f"{key}={value}\n" if l.startswith(key + "=") else l for l in p.read_text().splitlines(True)))
PY
  else echo "$1=$2" >> "$ENV_FILE"; fi
}
MODEL_DIR="$APP/data/calibration/classifier/model"
if [ "${QUIRE_NO_MODEL:-}" != 1 ]; then
  if [ -f "$MODEL_DIR/model.safetensors" ]; then
    say "The AI-writing model is already there"
  else
    say "Downloading the AI-writing model (about 575 MB)"
    tmp="$(mktemp -d)"
    if curl -fL --progress-bar -o "$tmp/model.zip" "$MODEL_URL" && mkdir -p "$MODEL_DIR" && \
       "$VPY" -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$tmp/model.zip" "$MODEL_DIR"; then
      :
    else
      warn "Could not download the model. Run the installer again later. Until then the AI estimate uses"
      warn "Binoculars, which downloads two 1.5B-parameter models (about 6 GB) the first time a draft is checked."
    fi
    rm -rf "$tmp"
  fi
  if [ -f "$MODEL_DIR/model.safetensors" ]; then
    set_env AI_DETECTOR classifier
    set_env AI_CLASSIFIER_THRESHOLD 0.2028
    set_env AI_CLASSIFIER_FALSE_POSITIVE_RATE 0.01
    set_env AI_CLASSIFIER_DETECTION_RATE 0.7556
  fi
fi

# Your settings (data/settings.json, the same file the Settings page edits): the Brave key and auto-update.
SETTINGS="$APP/data/settings.json"; mkdir -p "$APP/data"
auto=""
[ -f "$SETTINGS" ] || case "$(ask "  Install new versions automatically when Quire starts? [y/N]" n)" in [yY]*) auto=true ;; *) auto=false ;; esac
key="${BRAVE_API_KEY:-}"
if [ -z "$key" ] && ! grep -qs '"braveApiKey": *"[^"]' "$SETTINGS"; then
  echo "  The similarity check searches the web with your own Brave Search API key. How to get one: README, Getting a Brave Search API key."
  key="$(ask "  Paste your key, or press Enter to add it later on Quire's Settings page:" "")"
fi
"$VPY" - "$SETTINGS" "$auto" "$key" <<'PY'
import json, sys, pathlib
path, auto, key = sys.argv[1:]
p = pathlib.Path(path)
try:
    s = json.loads(p.read_text(encoding="utf-8"))
except (OSError, ValueError):
    s = {}
out = {"autoUpdate": (auto == "true") if auto else bool(s.get("autoUpdate")), "braveApiKey": key.strip() or str(s.get("braveApiKey") or "")}
p.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
PY

chmod +x "$APP/scripts/quire.sh" "$APP/scripts/update.sh"
BIN="$HOME/.local/bin"; mkdir -p "$BIN"
ln -sf "$APP/scripts/quire.sh" "$BIN/quire"
ln -sf "$APP/scripts/update.sh" "$BIN/quire-update"
if [ "$(uname)" != Darwin ] && [ -d "$HOME/.local/share" ]; then
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/quire.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Quire
Comment=Check your own drafts for matching sources and AI-like writing
Exec=$APP/scripts/quire.sh
Icon=$APP/scripts/quire.png
Terminal=false
Categories=Education;Office;
DESKTOP
fi
case ":$PATH:" in *":$BIN:"*) ;; *) warn "Add $BIN to your PATH to run quire and quire-update from any terminal." ;; esac

say "Quire is installed. Start it with: quire   (stop: quire --stop, update: quire-update)"
[ "${QUIRE_YES:-}" = 1 ] || case "$(ask "  Open Quire now? [Y/n]" y)" in [yY]*) "$APP/scripts/quire.sh" ;; esac
