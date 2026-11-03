#!/usr/bin/env bash
# Installs Quire on macOS or Linux: the app, its Python worker, the AI-writing model, and a `quire` command.
#
#   curl -fsSL https://raw.githubusercontent.com/chakradhar09/quire/main/scripts/install.sh | bash
#
# Needs Git, Node.js 22.13+ and Python 3.11 or 3.12 (it says how to get any that are missing). Everything goes into one
# folder (default ~/.quire): the code in app/, your drafts and the database in app/data/. Run it again to repair
# an install; run `quire-update` to update and `quire-uninstall` to remove it.
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
# A Node.js this installer put in $DIR/node (below) comes first; quire.sh and update.sh do the same.
if [ -d "$DIR/node/bin" ]; then PATH="$DIR/node/bin:$PATH"; fi

say() { printf '\033[32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m  !\033[0m %s\n' "$*"; }
ask() { # ask "question" default
  # No terminal to ask in (QUIRE_YES, or no /dev/tty that opens, as under CI or some containers): the default.
  if [ "${QUIRE_YES:-}" = 1 ] || ! { : </dev/tty; } 2>/dev/null; then echo "$2"; return; fi
  local answer; read -r -p "$1 " answer </dev/tty || true; echo "${answer:-$2}"
}
# at_least "have" "want": version comparison with awk (macOS's sort has no -V before macOS 13).
ver() { echo "$1" | awk -F. '{ printf "%d%03d%03d\n", $1, $2, $3 }'; }
at_least() { [ "$(ver "$1")" -ge "$(ver "$2")" ]; }

# Python 3.11 or 3.12: the OCR package has no build for 3.13 or later yet.
good_python() { "$1" -c 'import sys; sys.exit(not (3, 11) <= sys.version_info[:2] < (3, 13))' 2>/dev/null; }
# ...that can also make the worker's virtual environment with pip in it. Debian and Ubuntu ship that part
# separately (python3.12-venv), and `import venv` works without it, so try one: a few seconds, once per Python.
venv_ok=""
can_venv() {
  case " $venv_ok " in *" $1 "*) return 0 ;; esac
  local t ok=1; t="$(mktemp -d)"
  if "$1" -m venv "$t/v" >/dev/null 2>&1 && "$t/v/bin/python" -m pip --version >/dev/null 2>&1; then ok=0; venv_ok="$venv_ok $1"; fi
  rm -rf "$t"; return $ok
}
# What is missing, as Homebrew formulae (a plain string: macOS's bash 3.2 trips on empty arrays under set -u);
# also finds the Python to use ($PY), and a right-version Python that can't make a venv ($no_venv).
find_missing() {
  missing=""
  command -v git >/dev/null || missing="$missing git"
  if ! command -v node >/dev/null || ! at_least "$(node --version | tr -d v)" 22.13.0; then missing="$missing node"; fi
  PY=""; no_venv=""
  # The last candidates are a Python this installer put in $DIR/python (below).
  for candidate in python3.12 python3.11 python3 python "$DIR"/python/cpython-3.12*/bin/python3.12; do
    command -v "$candidate" >/dev/null && good_python "$candidate" || continue
    if can_venv "$candidate"; then PY="$candidate"; break; fi
    no_venv="$candidate"
  done
  [ -n "$PY" ] || missing="$missing python@3.12"
}

# uv (astral.sh) installs Python packages several at a time, far faster than pip, and provides the private
# Python below. It lives in $DIR/uv; pip is the fallback when it can't be downloaded.
get_uv() {
  [ -x "$DIR/uv/uv" ] || { mkdir -p "$DIR" && curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$DIR/uv" sh -s -- --quiet; } || true
  [ -x "$DIR/uv/uv" ]
}

say "Checking for Git, Node.js and Python"
find_missing
if [ -n "$missing" ] && [ "$(uname)" = Darwin ] && command -v brew >/dev/null; then
  warn "Quire needs:$missing."
  case "$(ask "  Install them now with Homebrew? [Y/n]" y)" in
    [yY]*) brew install $missing && find_missing ;;  # unquoted on purpose: one formula per word
  esac
fi
if [ -z "$PY" ]; then
  # No Homebrew, or Linux: a private Python 3.12 inside $DIR, from uv (astral.sh). No admin rights, and nothing
  # outside $DIR changes: no shell profile edits, no system packages.
  if [ -n "$no_venv" ]; then
    warn "Your $no_venv can't create virtual environments, which Quire needs (on Debian and Ubuntu that is the"
    warn "$("$no_venv" -c 'import sys; print("python%d.%d-venv" % sys.version_info[:2])') package)."
  else
    warn "Quire needs Python 3.11 or 3.12 (yours is missing, or 3.13 and later, which Quire can't use yet)."
  fi
  case "$(ask "  Install a private Python 3.12 just for Quire, in $DIR? [Y/n]" y)" in
    [yY]*)
      get_uv && UV_PYTHON_INSTALL_DIR="$DIR/python" "$DIR/uv/uv" python install --no-bin 3.12 && find_missing ;;
  esac
fi
# The same for Node.js: the official 22.x build from nodejs.org, checked against its published SHA-256, in $DIR/node.
install_node() {
  local os arch tmp file sum got
  case "$(uname)" in Darwin) os=darwin ;; *) os=linux ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) warn "nodejs.org has no build for $(uname -m)."; return 1 ;; esac
  tmp="$(mktemp -d)"
  curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$tmp/sums" || return 1
  read -r sum file <<<"$(awk -v want="-$os-$arch.tar.gz" 'substr($2, length($2) - length(want) + 1) == want' "$tmp/sums")"
  [ -n "$file" ] || { warn "nodejs.org lists no $os-$arch build."; return 1; }
  say "Downloading $file"
  curl -fL --progress-bar -o "$tmp/$file" "https://nodejs.org/dist/latest-v22.x/$file" || return 1
  if command -v sha256sum >/dev/null; then got="$(sha256sum "$tmp/$file")"; else got="$(shasum -a 256 "$tmp/$file")"; fi
  [ "${got%% *}" = "$sum" ] || { warn "The download doesn't match its published checksum; not installing it."; rm -rf "$tmp"; return 1; }
  rm -rf "$DIR/node" && mkdir -p "$DIR/node" && tar -xzf "$tmp/$file" -C "$DIR/node" --strip-components 1 || return 1
  rm -rf "$tmp"
  PATH="$DIR/node/bin:$PATH"
}
case "$missing" in *node*)
  warn "Quire needs Node.js 22.13 or later (yours is missing or older)."
  case "$(ask "  Install a private Node.js 22 just for Quire, in $DIR? [Y/n]" y)" in
    [yY]*) mkdir -p "$DIR" && install_node && find_missing ;;
  esac ;;
esac
# Git on Linux: the system's package manager (it needs your password; a private Git is not worth it).
case "$missing" in *git*) if [ "$(uname)" != Darwin ]; then
  pm=""
  if command -v apt-get >/dev/null; then pm="apt-get update -qq && apt-get install -y git"
  elif command -v dnf >/dev/null; then pm="dnf install -y git"
  elif command -v pacman >/dev/null; then pm="pacman -S --noconfirm --needed git"
  elif command -v zypper >/dev/null; then pm="zypper --non-interactive install git"
  elif command -v apk >/dev/null; then pm="apk add git"; fi
  sudo=""; [ "$(id -u)" = 0 ] || sudo="sudo"
  if [ -n "$pm" ] && { [ -z "$sudo" ] || command -v sudo >/dev/null; }; then
    warn "Quire needs Git."
    case "$(ask "  Install it now with: ${sudo:+sudo }sh -c \"$pm\"? [Y/n]" y)" in
      [yY]*) if $sudo sh -c "$pm"; then find_missing; else warn "Installing Git failed."; fi ;;
    esac
  fi
fi ;; esac
if [ -n "$missing" ]; then
  warn "Quire still needs:$missing (Node.js 22.13 or later, Python 3.11 or 3.12)."
  if [ "$(uname)" = Darwin ]; then warn "Install Homebrew from brew.sh, then: brew install$missing"
  else warn "With your package manager, e.g.: sudo apt install git python3.12 python3.12-venv; Node.js 22 from nodejs.org or nvm."; fi
  warn "Then run the installer again."
  exit 1
fi

mkdir -p "$DIR"
# The AI-writing model (about 575 MB) downloads in the background while the rest installs, into $DIR/download
# until it is unpacked; a download that was cut off carries on where it stopped (-C -) the next time.
MODEL_DIR="$APP/data/calibration/classifier/model"
MODEL_ZIP="$DIR/download/${MODEL_URL##*/}"
model_pid=""
stop_model() { if [ -n "$model_pid" ]; then pkill -P "$model_pid" 2>/dev/null || true; kill "$model_pid" 2>/dev/null || true; fi; }
if [ "${QUIRE_NO_MODEL:-}" != 1 ] && [ ! -f "$MODEL_DIR/model.safetensors" ] && [ ! -f "$MODEL_ZIP" ]; then
  mkdir -p "$DIR/download"
  say "Downloading the AI-writing model (about 575 MB) in the background"
  { curl -fsSL --retry 3 -C - -o "$MODEL_ZIP.part" "$MODEL_URL" && mv "$MODEL_ZIP.part" "$MODEL_ZIP"; } 2>"$DIR/download/model.log" &
  model_pid=$!
  trap stop_model EXIT
fi

if [ -d "$APP/.git" ]; then
  say "Quire is already in $APP; repairing it in place"
  # A copy on a release moves to the newest one, so a release that can't install is repaired by the next, or by
  # its tag moved to a fixed commit (--force takes a moved tag). A copy between releases, a
  # developer's, is left where it is. Your drafts (app/data) are not in Git.
  if current="$(git -C "$APP" describe --tags --exact-match --match "v*" 2>/dev/null)" && git -C "$APP" fetch --quiet --tags --force 2>/dev/null; then
    tag="$(git -C "$APP" tag --list 'v*' --sort=-v:refname | head -1)"
    if [ -n "$tag" ] && [ "$(git -C "$APP" rev-parse "$tag^{commit}")" != "$(git -C "$APP" rev-parse HEAD)" ] && at_least "${tag#v}" "${current#v}"; then
      if git -C "$APP" -c core.fileMode=false checkout --quiet "$tag"; then say "Moved from release $current to the current $tag"
      else warn "Could not move to $tag; repairing $current instead."; fi
    fi
  fi
else
  say "Downloading Quire into $APP"
  git clone --quiet "$SOURCE" "$APP"
  tag="$(git -C "$APP" tag --list 'v*' --sort=-v:refname | head -1)"
  if [ -n "$tag" ]; then git -C "$APP" checkout --quiet "$tag"; say "Using release $tag"; fi
fi
# The scripts are made executable below. Git must not count that as a local change, or updating to a release
# that changes them stops with "Your local changes would be overwritten" (the first 0.1.0's update.sh did).
git -C "$APP" config core.fileMode false

say "Setting up the worker's Python environment (this downloads PyTorch, a few hundred MB to 2.5 GB)"
if [ -x "$APP/worker/.venv/bin/python" ] && ! good_python "$APP/worker/.venv/bin/python"; then rm -rf "$APP/worker/.venv"; fi
[ -x "$APP/worker/.venv/bin/python" ] || "$PY" -m venv "$APP/worker/.venv"
VPY="$APP/worker/.venv/bin/python"
if get_uv; then
  pip_install() { "$DIR/uv/uv" pip install --python "$VPY" "$@"; }
else
  warn "Could not download uv; installing with pip instead, which is slower."
  "$VPY" -m pip install --quiet --upgrade pip
  pip_install() { "$VPY" -m pip install --quiet "$@"; }
fi
if [ "$(uname)" = Darwin ]; then
  say "PyTorch $TORCH_VERSION (Apple silicon GPUs included)"
  pip_install "torch==$TORCH_VERSION"
elif [ "${QUIRE_CPU:-}" != 1 ] && command -v nvidia-smi >/dev/null; then
  say "PyTorch $TORCH_VERSION for your NVIDIA GPU"
  pip_install "torch==$TORCH_VERSION" --index-url https://download.pytorch.org/whl/cu130
else
  say "PyTorch $TORCH_VERSION for the CPU"
  pip_install "torch==$TORCH_VERSION" --index-url https://download.pytorch.org/whl/cpu
fi
pip_install -r "$APP/worker/requirements.txt"

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
unzip_model() { # unzip_model ZIP DIR: every file's checksum is tested first, so a damaged download isn't unpacked
  "$VPY" - "$1" "$2" <<'PY'
import sys, zipfile
try:
    with zipfile.ZipFile(sys.argv[1]) as z:
        if z.testzip() is None:
            z.extractall(sys.argv[2])
            sys.exit(0)
except (zipfile.BadZipFile, OSError):
    pass
sys.exit(1)
PY
}
if [ "${QUIRE_NO_MODEL:-}" != 1 ]; then
  if [ -f "$MODEL_DIR/model.safetensors" ]; then
    say "The AI-writing model is already there"
  else
    if [ -n "$model_pid" ]; then
      if kill -0 "$model_pid" 2>/dev/null; then
        say "Waiting for the AI-writing model to finish downloading"
        while kill -0 "$model_pid" 2>/dev/null; do
          printf '\r    %s MB of about 575 ' "$(( $(wc -c 2>/dev/null <"$MODEL_ZIP.part" || echo 0) / 1048576 ))"; sleep 2
        done
        echo
      fi
      wait "$model_pid" || true; model_pid=""
    fi
    # A .part can be whole: resuming a finished download, some curl versions report the server's "nothing left
    # to send" as an error.
    zip="$MODEL_ZIP"; [ -f "$zip" ] || zip="$MODEL_ZIP.part"
    if [ -f "$zip" ]; then
      say "Unpacking the AI-writing model"
      rm -rf "$MODEL_DIR"; mkdir -p "$MODEL_DIR"
      if unzip_model "$zip" "$MODEL_DIR"; then rm -rf "$DIR/download"
      elif [ "$zip" = "$MODEL_ZIP" ]; then rm -rf "$MODEL_DIR" "$zip"; warn "The downloaded model was damaged and was deleted."
      else rm -rf "$MODEL_DIR"; warn "The model download didn't finish: $(tail -1 "$DIR/download/model.log" 2>/dev/null)"; fi
    else
      warn "Could not download the model: $(tail -1 "$DIR/download/model.log" 2>/dev/null)"
    fi
    if [ ! -f "$MODEL_DIR/model.safetensors" ]; then
      warn "Run the installer again later; it carries on where the download stopped. Until then the AI estimate uses"
      warn "Binoculars, which downloads two 1.5B-parameter models (about 6 GB) the first time a draft is checked."
    fi
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

chmod +x "$APP"/scripts/*.sh
BIN="$HOME/.local/bin"; mkdir -p "$BIN"
ln -sf "$APP/scripts/quire.sh" "$BIN/quire"
ln -sf "$APP/scripts/update.sh" "$BIN/quire-update"
[ ! -f "$APP/scripts/uninstall.sh" ] || ln -sf "$APP/scripts/uninstall.sh" "$BIN/quire-uninstall"
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
case ":$PATH:" in *":$BIN:"*) ;; *) warn "Add $BIN to your PATH to run quire, quire-update and quire-uninstall from any terminal." ;; esac

say "Quire is installed. Start it with: quire   (stop: quire --stop, update: quire-update, remove: quire-uninstall)"
[ "${QUIRE_YES:-}" = 1 ] || case "$(ask "  Open Quire now? [Y/n]" y)" in [yY]*) "$APP/scripts/quire.sh" ;; esac
