# dating-chad 💬🔥

Your AI **message wingman** for dating apps. Paste a match's profile and your
conversation, and `dating-chad` analyzes both and suggests the best message to
**open** or **continue** the dialog — in the tone you choose.

Works with conversations from **Tinder, Badoo, Hinge, Bumble**, and any other
text-based chat.

---

## ✨ What it does

- **Profile analysis** — reads bio/interests and surfaces vibe, shared-interest
  hooks, and compatibility notes.
- **Conversation analysis** — whose turn it is, sentiment, engagement level, and
  green/red flags.
- **Smart suggestions** — one tailored message per tone you pick (playful,
  sincere, witty, flirty, funny…), each with a short rationale.
- **Two engines** — uses OpenAI when an API key is set, otherwise a built-in
  **heuristic mode** so it runs with zero setup.
- **Connector layer** — a ToS-safe manual/import flow plus a documented
  (opt-in, unofficial) Tinder connector.

---

## ⚖️ Important: how it "accesses" conversations

Tinder, Badoo, and similar apps **do not offer a public API** for reading your
messages, and automating logins/scraping generally **violates their Terms of
Service** and can get accounts banned. `dating-chad` is built to be useful
*and* responsible:

| Connector | Status | Notes |
|-----------|--------|-------|
| **Manual / import** | ✅ Recommended | Paste the chat, or import via each app's official **"Download my data"** export. Fully ToS-safe. |
| **Tinder (unofficial)** | ⚠️ Opt-in | Talks to private endpoints via an `X-Auth-Token`. Unofficial, fragile, ToS-risky. Disabled unless you set `TINDER_X_AUTH_TOKEN`. Provided as a structural example only. |
| **Badoo** | ❌ Not available | No usable endpoint. Use the manual/import flow. |

This tool helps you write **your own authentic messages** — no impersonation,
deception, or pressure. Respect a clear lack of interest.

---

## 🚀 Quick start (Windows / PowerShell)

```powershell
cd "dating-chad"

# 1. Create & activate a virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. (Optional) configure your API key
Copy-Item .env.example .env
#   then edit .env and set OPENAI_API_KEY=sk-...
#   (skip this to run in heuristic mode)

# 4. Run it
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000> in your browser.

> No API key? It still works — you'll see an `⚙️ heuristic mode` badge and get
> template-based suggestions. Add `OPENAI_API_KEY` to `.env` for AI-quality ones.

---

## 🧩 Browser extension — the "Suggest message" button

This is the flow you want: while you're **actually in Badoo/Tinder**, open a
chat and click a floating **💬 Suggest message** button. The extension:

1. Scrapes the open conversation (and the visible profile) from the page.
2. If the chat is **empty → analyzes the profile → suggests openers.**
3. If the chat has messages → **analyzes the whole dialog → suggests replies.**
4. Shows ranked suggestions (one per tone) with one-click **Copy**.

It always shows an **editable transcript** first, because dating apps obfuscate
and frequently change their HTML — so auto-scraping is best-effort and you can
correct it in one place before generating.

### Install (Chrome / Edge / Brave)

1. Make sure the backend is running (`uvicorn app.main:app --reload`).
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and select the `dating-chad/extension` folder.
5. Open Badoo/Tinder, open a chat, and click the **💬 Suggest message** button
   (bottom-right). Click the extension icon to set the backend URL / default tones.

> The extension calls your **local** backend only. Nothing is sent anywhere
> except to your own server (and, if you configured one, your OpenAI key from
> the backend). Scraping happens entirely in your browser.

### If scraping misses messages

Class names on these sites change often. Just paste/fix the chat in the panel's
transcript box (format `me:` / `them:` per line) and hit **Suggest** — or tweak
the selectors in `extension/adapters.js`.

---

## 🗂️ Project structure

```
dating-chad/
├─ app/
│  ├─ main.py              # FastAPI app + routes
│  ├─ config.py            # settings from .env
│  ├─ models.py            # pydantic schemas
│  ├─ analysis/
│  │  ├─ engine.py         # LLM + heuristic suggestion engine
│  │  └─ prompts.py        # prompt templates
│  └─ connectors/
│     ├─ base.py           # connector abstraction
│     ├─ manual.py         # paste / import (recommended)
│     └─ tinder.py         # unofficial, opt-in stub
├─ extension/              # browser extension (MV3) with the Suggest button
│  ├─ manifest.json
│  ├─ background.js        # CORS-safe fetch proxy to the backend
│  ├─ adapters.js          # per-site scrapers (Badoo/Tinder/Bumble/Hinge)
│  ├─ content.js           # floating button + suggestion panel
│  ├─ panel.css
│  ├─ popup.html / popup.js # settings (backend URL, default tones)
├─ web/                    # single-page UI (HTML/CSS/JS)
├─ requirements.txt
└─ .env.example
```

---

## 🔌 API

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Active engine + model info |
| `POST` | `/api/suggest` | Structured request (profile + message list) |
| `POST` | `/api/suggest-from-transcript` | Paste a raw `me:/them:` transcript |
| `POST` | `/api/parse-transcript` | Parse a transcript into structured messages |
| `GET`  | `/api/connectors/{name}/matches` | Fetch matches from a connector |

Transcript format:

```
them: hey! love that you're into climbing
me: haha guilty — indoor or real rock?
them: real rock, did my first multi-pitch last month
```

### Example

```powershell
curl -X POST http://127.0.0.1:8000/api/suggest-from-transcript `
  -H "Content-Type: application/json" `
  -d '{\"profile\":{\"name\":\"Alex\",\"bio\":\"climber, coffee snob, dog mom\"},\"transcript\":\"them: hey!\",\"goal\":\"continue\",\"tone\":[\"playful\",\"sincere\"]}'
```

---

## 🛡️ Disclaimer

`dating-chad` is for personal, good-faith use to help you communicate better.
You are responsible for complying with each platform's Terms of Service and
applicable laws. The unofficial Tinder connector is provided as-is, with no
guarantee it works and a real risk of account restrictions.
