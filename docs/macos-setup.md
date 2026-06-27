# macOS setup

`dating-chad` was originally built on Windows. This guide covers running it on
macOS — the backend, the single-page web UI, and the browser extension. Nothing
about the app is Windows-specific; only the helper tooling differs, and macOS
equivalents are included here.

> In a hurry? See the **Quick start (macOS / Linux)** section in the
> [README](../README.md). This doc is the longer, troubleshooting-friendly version.

---

## 1. Prerequisites

- **Python 3.10+** (developed/tested on 3.12). Check with `python3 --version`.
  - If you don't have it: `brew install python` (requires [Homebrew](https://brew.sh)),
    or grab the installer from [python.org](https://www.python.org/downloads/macos/).
- **curl** — preinstalled on macOS.
- **A Chromium browser** (Chrome / Edge / Brave) if you want the in-page
  "💬 Suggest message" extension. Optional — the web UI works in any browser.

No API key is required: with an empty `OPENAI_API_KEY` the app runs in
**heuristic mode** and produces template-based suggestions.

---

## 2. Backend setup

From the repo root:

```bash
# 1. Create & activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate          # zsh/bash. (fish: source .venv/bin/activate.fish)

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment (optional — heuristic mode works without it)
cp .env.example .env
#    then edit .env and set OPENAI_API_KEY=sk-...   for AI-quality suggestions

# 4. Run
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>. You should see the web UI. A green
`⚙️ heuristic mode` badge means no key is set (expected if you skipped step 3).

### Verify it works

```bash
# health check
curl http://127.0.0.1:8000/api/health
# -> {"status":"ok","engine":"heuristic",...}

# offline smoke test (exercises the engine + API end-to-end)
python smoke_test.py
```

---

## 3. One-shot launcher

Instead of starting the server by hand, use the macOS/Linux launcher
([`launch.sh`](../launch.sh) — the equivalent of the Windows `launch.ps1`):

```bash
./launch.sh
```

It will:

1. Reuse the backend if it's already serving on port 8000, otherwise start it
   (and free the port first if something is stuck on it).
2. Open a browser:
   - If a **Chrome for Testing** build exists under `.cft/`, it launches that
     with the extension auto-loaded (`--load-extension`), pointed at Badoo.
   - Otherwise it opens the **web UI** in your default browser and prints
     instructions for loading the extension manually (see next section).

Backend output is written to `.backend.log` (git-ignored).

> **Why Chrome for Testing?** Regular Chrome 137+ blocks `--load-extension`, so
> the auto-load path needs Google's Chrome for Testing build. The repo doesn't
> ship or download it, so by default the launcher falls back to the web UI +
> manual extension load, which is all you need for development.

---

## 4. Browser extension

The extension is plain MV3 — load it the same way on macOS as anywhere else:

1. Make sure the backend is running (`./launch.sh` or `uvicorn app.main:app --reload`).
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `extension/` folder in this repo.
5. Open Badoo/Tinder/Hinge/Bumble, open a chat, and click the floating
   **💬 Suggest message** button (bottom-right). Click the extension's toolbar
   icon to set the backend URL / default tones.

The extension only ever calls your **local** backend (`http://127.0.0.1:8000`).

---

## 5. Troubleshooting

**`python3: command not found`** — install Python (`brew install python`) or
add the python.org install to your `PATH`.

**`source .venv/bin/activate` does nothing / wrong Python** — confirm the venv
was created with `python3 -m venv .venv` and that `which python` points inside
`.venv/bin` after activating.

**Port 8000 already in use** — find and stop the process:

```bash
lsof -ti tcp:8000 -sTCP:LISTEN | xargs kill
```

`launch.sh` does this automatically when the port is stuck.

**`./launch.sh: permission denied`** — make it executable: `chmod +x launch.sh`.

**Extension can't reach the backend** — verify `curl http://127.0.0.1:8000/api/health`
returns `ok`, and that the backend URL in the extension popup matches.

**`_devtools_check.py`** (an optional CDP-based extension-injection check)
requires `pip install websocket-client` and a browser started with
`--remote-debugging-port=9222`. It's a dev utility, not part of normal setup.

---

## Windows → macOS differences at a glance

| Concern | Windows | macOS / Linux |
|---------|---------|---------------|
| Activate venv | `.\.venv\Scripts\Activate.ps1` | `source .venv/bin/activate` |
| Python interpreter | `.venv\Scripts\python.exe` | `.venv/bin/python` |
| Copy env file | `Copy-Item .env.example .env` | `cp .env.example .env` |
| Launcher | `launch.ps1` | `launch.sh` |
| Chrome for Testing path | `.cft\chrome-win64\chrome.exe` | `.cft/chrome-mac-{arm64,x64}/Google Chrome for Testing.app/...` |
