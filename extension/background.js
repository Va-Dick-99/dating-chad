// Service worker: a CORS-safe proxy between the content script and the backend.
// Because requests originate here (with host_permissions), they bypass page CORS.

const DEFAULTS = {
  backendUrl: "http://127.0.0.1:8000",
  tones: ["playful", "sincere", "witty"],
};

async function getConfig() {
  const local = await chrome.storage.local.get(DEFAULTS);
  const sync = await chrome.storage.sync.get(DEFAULTS).catch(() => ({}));
  return { ...DEFAULTS, ...sync, ...local };
}

async function saveConfig(partial) {
  // local is reliable in unpacked / CfT profiles; sync needs a signed-in Google account.
  await chrome.storage.local.set(partial);
  try {
    await chrome.storage.sync.set(partial);
  } catch {
    // sync optional — ignore if unavailable
  }
}

function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Service workers have no FileReader, so we base64-encode the bytes ourselves.
// The background can fetch cross-origin image hosts thanks to <all_urls> perms.
async function imageToDataUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("img " + r.status);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 4 * 1024 * 1024) throw new Error("image too large");
  const type = r.headers.get("content-type") || "image/jpeg";
  return `data:${type};base64,${arrayBufferToBase64(buf)}`;
}

async function resolvePhotos(urls, max) {
  const out = [];
  for (const u of (urls || []).slice(0, max)) {
    try {
      out.push(await imageToDataUrl(u));
    } catch (e) {
      // skip images we can't fetch/encode
    }
  }
  return out;
}

async function fetchBackend(url, options, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_CONFIG") {
    getConfig().then(sendResponse);
    return true;
  }

  if (msg?.type === "SAVE_CONFIG") {
    (async () => {
      try {
        const tones = msg.tones?.length ? msg.tones : DEFAULTS.tones;
        await saveConfig({ tones });
        sendResponse({ ok: true, tones });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "SUGGEST") {
    (async () => {
      try {
        const { backendUrl } = await getConfig();
        const payload = { ...msg.payload };
        // Turn scraped photo URLs into base64 data URLs the backend can forward.
        if (payload.photoUrls && payload.photoUrls.length) {
          payload.photos = await resolvePhotos(payload.photoUrls, 3);
          delete payload.photoUrls;
        }
        const res = await fetchBackend(`${backendUrl.replace(/\/$/, "")}/api/suggest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          sendResponse({
            ok: false,
            error: `Backend ${res.status}${detail ? ": " + detail.slice(0, 200) : ""}`,
          });
          return;
        }
        sendResponse({ ok: true, data: await res.json() });
      } catch (e) {
        const msg = e?.name === "AbortError"
          ? "Backend не ответил за 2 минуты. Перезапусти dating-chad (launch.ps1)."
          : e?.message || String(e);
        sendResponse({
          ok: false,
          error:
            "Couldn't reach the dating-chad backend. Is it running? " +
            "(uvicorn app.main:app) — " +
            msg,
        });
      }
    })();
    return true; // keep the channel open for the async response
  }

  return false;
});
