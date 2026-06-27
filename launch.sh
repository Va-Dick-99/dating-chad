#!/usr/bin/env bash
# dating-chad launcher (macOS / Linux) — port of launch.ps1.
# Starts the backend (if not running) and opens a browser with the extension.
# Regular Chrome 137+ blocks --load-extension, so if a Chrome for Testing build
# is present under .cft/ we use that; otherwise we open the web UI in your
# default browser and you load the extension manually once (see README).

set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ext="$root/extension"
prof="$root/.cft-profile"
py="$root/.venv/bin/python"
url="http://127.0.0.1:8000"

# 1. Backend: start it if the health endpoint isn't already responding.
if curl -fsS "$url/api/health" >/dev/null 2>&1; then
  echo "Backend already running."
else
  # Free a stuck port if something is holding 8000 without serving health.
  stuck="$(lsof -ti tcp:8000 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$stuck" ]; then
    echo "Port 8000 stuck — restarting backend..."
    kill $stuck 2>/dev/null || true
    sleep 2
  fi
  if [ ! -x "$py" ]; then
    echo "No virtualenv at $py" >&2
    echo "Run: python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt" >&2
    exit 1
  fi
  echo "Starting backend..."
  "$py" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >"$root/.backend.log" 2>&1 &
  for _ in $(seq 1 20); do
    curl -fsS "$url/api/health" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

# 2. Browser: prefer a Chrome for Testing build (lets us auto-load the extension).
cft=""
for candidate in \
  "$root/.cft/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  "$root/.cft/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"; do
  if [ -x "$candidate" ]; then cft="$candidate"; break; fi
done

if [ -n "$cft" ]; then
  mkdir -p "$prof"
  rm -f "$prof/SingletonLock" "$prof/SingletonCookie" "$prof/SingletonSocket" 2>/dev/null || true
  "$cft" --user-data-dir="$prof" --load-extension="$ext" \
    --no-first-run --no-default-browser-check https://badoo.com &
  echo "Launched Chrome for Testing with dating-chad. Log into Badoo and open a chat."
else
  echo "Chrome for Testing not found under .cft/ — opening the web UI instead: $url"
  echo "To use the in-page '💬 Suggest message' button, load the extension once:"
  echo "  Chrome/Edge/Brave → chrome://extensions → Developer mode → Load unpacked → $ext"
  open "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || true
fi
