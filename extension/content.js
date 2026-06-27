// Injects the "Suggest message" button + panel, scrapes the open chat/profile,
// and renders suggestions from the dating-chad backend.

(function () {
  if (window.__datingChadLoaded) return;
  window.__datingChadLoaded = true;

  const ALL_TONES = ["playful", "sincere", "witty", "flirty", "funny"];
  const TONE_LABELS = {
    playful: "игривый",
    sincere: "искренний",
    witty: "остроумный",
    flirty: "флиртующий",
    funny: "смешной",
  };
  const DEFAULT_TONES = ["playful", "sincere", "witty"];
  let config = { tones: DEFAULT_TONES };
  let scrapedPhotos = [];
  let scrapedProfile = null;
  let scrapedConvKey = ""; // identity of the conversation scrapedProfile belongs to

  // Read saved tones directly — no service worker round-trip (avoids "port closed" errors).
  chrome.storage.local.get({ tones: DEFAULT_TONES }, (stored) => {
    if (chrome.runtime.lastError) return;
    if (stored?.tones?.length) config.tones = stored.tones;
    renderToneChips();
  });

  // ---------- UI scaffolding ----------
  const fab = document.createElement("button");
  fab.className = "dc-fab";
  fab.title = "dating-chad: подсказать сообщение";
  fab.innerHTML = "💬 Подсказать";
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.className = "dc-panel dc-hidden";
  panel.innerHTML = `
    <div class="dc-head">
      <span class="dc-logo">💬🔥 dating-chad</span>
      <button class="dc-close" title="Закрыть">✕</button>
    </div>
    <div class="dc-body">
      <div class="dc-goal" id="dc-goal"></div>
      <label class="dc-label">Переписка <span class="dc-hint">(распознана автоматически — поправь при необходимости)</span></label>
      <textarea class="dc-transcript" id="dc-transcript" rows="6"
        placeholder="она: ...\nя: ..."></textarea>
      <label class="dc-label">Профиль собеседника <span class="dc-hint">(открой полную анкету в Badoo → ↻ Пересканировать)</span></label>
      <textarea class="dc-profile" id="dc-profile" rows="6" placeholder="имя, био, промпты, интересы…"></textarea>
      <label class="dc-label">По фотографиям <span class="dc-hint">(после «Подсказать»)</span></label>
      <textarea class="dc-photo-info" id="dc-photo-info" rows="3"
        placeholder="Разбор фото появится здесь, если в профиле есть фотки"></textarea>
      <div class="dc-photos" id="dc-photos"></div>
      <div class="dc-tones-wrap">
        <div class="dc-tones-head">
          <span class="dc-label dc-tones-title">Стили сообщений</span>
          <button class="dc-save-tones" id="dc-save-tones" type="button">💾 Сохранить</button>
        </div>
        <div class="dc-tones" id="dc-tones"></div>
        <div class="dc-tones-status" id="dc-tones-status"></div>
      </div>
      <div class="dc-actions">
        <button class="dc-rescrape" id="dc-rescrape">↻ Пересканировать</button>
        <button class="dc-go" id="dc-go">Подсказать ✨</button>
      </div>
      <div class="dc-results" id="dc-results"></div>
    </div>`;
  document.body.appendChild(panel);

  const $ = (id) => panel.querySelector(id);

  function renderToneChips() {
    const wrap = $("#dc-tones");
    if (!wrap) return;
    wrap.innerHTML = "";
    ALL_TONES.forEach((t) => {
      const label = document.createElement("label");
      label.className = "dc-chip";
      label.innerHTML = `<input type="checkbox" value="${t}" ${
        config.tones?.includes(t) ? "checked" : ""
      }/> ${TONE_LABELS[t] || t}`;
      wrap.appendChild(label);
    });
  }

  function selectedTones() {
    const checked = [...panel.querySelectorAll("#dc-tones input:checked")].map((c) => c.value);
    return checked.length ? checked : ["sincere"];
  }

  // ---------- scraping ----------
  function transcriptFromMessages(messages) {
    return messages.map((m) => `${m.sender}: ${m.text}`).join("\n");
  }

  const ME_TAGS = ["me", "you", "i", "я", "мне", "меня"];
  function parseTranscript(textValue) {
    const out = [];
    for (const raw of (textValue || "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(me|them|you|i|they|я|мне|меня|он|она|они|собеседник|мэтч)\s*[:\-]\s*(.+)$/i);
      if (m) {
        const tag = m[1].toLowerCase();
        const sender = ME_TAGS.includes(tag) ? "me" : "them";
        out.push({ sender, text: m[2].trim() });
      } else if (out.length) {
        out[out.length - 1].text += "\n" + line;
      }
    }
    return out;
  }

  function buildApiProfile(manualText) {
    const base = scrapedProfile
      ? { ...scrapedProfile, app: scrapedProfile.app || panel.dataset.app || null }
      : { app: panel.dataset.app || null };
    delete base.bioText;
    delete base.sections;
    const manual = (manualText || "").trim();
    if (manual && (!scrapedProfile?.bioText || manual !== scrapedProfile.bioText.trim())) {
      base.bio = manual;
    }
    const hasData =
      base.name ||
      base.bio ||
      base.work ||
      base.education ||
      base.goals ||
      base.goal ||
      base.interests?.length ||
      base.prompts?.length ||
      base.details?.length;
    return hasData ? base : manual ? { bio: manual, app: base.app } : null;
  }

  // Rough richness score so a background re-scan never replaces a detailed
  // profile (captured from the open full-profile modal) with the thin chat
  // header (name/age only) that Badoo shows once the modal is closed.
  function profileRichness(p) {
    if (!p) return 0;
    return (
      (p.bio ? 20 : 0) +
      (p.work ? 8 : 0) +
      (p.education ? 4 : 0) +
      (p.goal ? 4 : 0) +
      (p.prompts?.length || 0) * 6 +
      (p.interests?.length || 0) * 2 +
      (p.details?.length || 0)
    );
  }

  // Identity of the open conversation. Stable while you open/close a match's
  // full profile (same chat → same messages), but different for a different
  // match. Empty when the chat isn't readable (e.g. hidden behind the modal),
  // which we treat as "unknown — don't reset".
  function conversationKey(messages) {
    if (!messages || !messages.length) return "";
    return messages.map((m) => m.sender + ":" + m.text).join("|").slice(0, 600);
  }

  function profileToBox(p) {
    return p?.bioText || [p?.name, p?.bio].filter(Boolean).join(" — ") || "";
  }

  function scrapePage(opts = {}) {
    const preserveResults = opts.preserveResults !== false;
    try {
      const adapter = window.DatingChad.pickAdapter();
      const { profile, messages, photos } = adapter.scrape();
      const newProfile = profile || null;
      const newMsgs = messages || [];
      const newPhotos = photos || [];

      const newKey = conversationKey(newMsgs);
      // A genuinely different match: a confident, non-empty key that CHANGED.
      // Opening/closing the profile keeps the same key, so it is not a switch.
      const switchedMatch = !!newKey && !!scrapedConvKey && newKey !== scrapedConvKey;

      if (switchedMatch) {
        // New conversation → start clean.
        scrapedProfile = newProfile;
        scrapedPhotos = newPhotos;
        $("#dc-profile").value = profileToBox(newProfile);
        $("#dc-transcript").value = transcriptFromMessages(newMsgs);
        panel.dataset.app = newProfile?.app || adapter.app || "";
        $("#dc-photo-info").value = "";
        $("#dc-results").innerHTML = "";
      } else {
        // Same match (or chat momentarily unreadable behind the open modal):
        // NEVER downgrade what we captured. This holds across every scrape path
        // — the MutationObserver re-scan AND the navigation/openPanel reset that
        // fires when Badoo's profile modal opens/closes (it changes the URL),
        // which the earlier preserveResults-only guard missed.
        if (!scrapedProfile || profileRichness(newProfile) > profileRichness(scrapedProfile)) {
          scrapedProfile = newProfile;
          $("#dc-profile").value = profileToBox(newProfile);
          panel.dataset.app = newProfile?.app || adapter.app || panel.dataset.app || "";
        }
        if (newPhotos.length > scrapedPhotos.length) scrapedPhotos = newPhotos;
        // Only refresh the transcript when the page actually shows messages, so
        // an open modal that hides the chat can't blank it.
        if (newMsgs.length) $("#dc-transcript").value = transcriptFromMessages(newMsgs);
        if (!preserveResults) $("#dc-photo-info").value = "";
      }

      if (newKey) scrapedConvKey = newKey;
      updateProfileHint();
      updateGoalLabel();
    } catch (e) {
      if (!preserveResults) {
        $("#dc-results").innerHTML = `<div class="dc-err">Не удалось распознать страницу автоматически. Вставь переписку вручную ниже.</div>`;
      }
    }
  }

  function updatePhotosLabel() {
    const el = $("#dc-photos");
    if (!el) return;
    const n = Math.min(scrapedPhotos.length, 3);
    const photoPart = n > 0 ? `📷 найдено ${n} фото` : "";
    const hintPart = el.dataset.hint || "";
    el.textContent = [photoPart, hintPart].filter(Boolean).join(" · ");
  }

  function updateProfileHint() {
    const el = $("#dc-photos");
    if (!el) return;
    const parts = [];
    if (scrapedProfile?.bio) parts.push("о себе");
    if (scrapedProfile?.work) parts.push("работа");
    if (scrapedProfile?.prompts?.length) parts.push(`${scrapedProfile.prompts.length} промпт`);
    if (scrapedProfile?.interests?.length) parts.push("интересы");
    el.dataset.hint = parts.length
      ? `✓ ${parts.join(", ")}`
      : "⚠️ открой полную анкету в Badoo → ↻ Пересканировать";
    updatePhotosLabel();
  }

  function fillPhotoInfo(pi) {
    const el = $("#dc-photo-info");
    if (!el || !pi) return;
    if (pi.photo_analysis) {
      el.value = pi.photo_analysis;
      return;
    }
    const parts = [];
    if (pi.vibe) parts.push(`Вайб: ${pi.vibe}`);
    if (pi.interests?.length) parts.push(`Интересы: ${pi.interests.join(", ")}`);
    if (pi.conversation_hooks?.length) parts.push(`Зацепки: ${pi.conversation_hooks.join("; ")}`);
    el.value = parts.join("\n");
  }

  function updateGoalLabel() {
    const msgs = parseTranscript($("#dc-transcript").value);
    const goalEl = $("#dc-goal");
    if (msgs.length === 0) {
      goalEl.innerHTML = `🆕 <b>Пустой чат</b> — проанализирую профиль и предложу, <b>чем начать</b>.`;
      goalEl.className = "dc-goal dc-goal-open";
    } else {
      goalEl.innerHTML = `💬 <b>${msgs.length} сообщений</b> — проанализирую диалог и предложу, <b>что ответить</b>.`;
      goalEl.className = "dc-goal dc-goal-continue";
    }
  }

  // ---------- suggest ----------
  async function suggest() {
    const goBtn = $("#dc-go");
    goBtn.disabled = true;
    goBtn.textContent = "Думаю…";
    suggesting = true;
    $("#dc-results").innerHTML = "";

    const messages = parseTranscript($("#dc-transcript").value);
    const profText = $("#dc-profile").value.trim();
    const payload = {
      profile: buildApiProfile(profText),
      conversation: messages,
      goal: messages.length === 0 ? "open" : "continue",
      tone: selectedTones(),
      photoUrls: scrapedPhotos.slice(0, 3),
    };

    chrome.runtime.sendMessage({ type: "SUGGEST", payload }, (resp) => {
      suggesting = false;
      goBtn.disabled = false;
      goBtn.textContent = "Подсказать ✨";
      if (chrome.runtime.lastError) {
        $("#dc-results").innerHTML = `<div class="dc-err">${chrome.runtime.lastError.message}</div>`;
        return;
      }
      if (!resp || !resp.ok) {
        $("#dc-results").innerHTML = `<div class="dc-err">${resp?.error || "Неизвестная ошибка"}</div>`;
        return;
      }
      renderResults(resp.data);
      fillPhotoInfo(resp.data.profile_insights);
    });
  }

  function saveTones() {
    const tones = selectedTones();
    const status = $("#dc-tones-status");
    chrome.storage.local.set({ tones }, () => {
      if (chrome.runtime.lastError) {
        if (status) {
          status.textContent = "Ошибка: " + chrome.runtime.lastError.message;
          status.className = "dc-tones-status dc-tones-err";
        }
        return;
      }
      config.tones = tones;
      if (status) {
        status.textContent = "Сохранено ✓";
        status.className = "dc-tones-status dc-tones-ok";
        setTimeout(() => {
          status.textContent = "";
          status.className = "dc-tones-status";
        }, 1800);
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function renderResults(data) {
    const ci = data.conversation_insights || {};
    const engineNote = data.engine === "heuristic"
      ? `<div class="dc-note">⚙️ режим без ИИ — добавь API-ключ в бэкенд для умных подсказок.</div>`
      : "";
    const insight = ci.summary
      ? `<div class="dc-insight">${escapeHtml(ci.summary)}</div>`
      : "";

    const cards = (data.suggestions || [])
      .map(
        (s) => `
        <div class="dc-card">
          <div class="dc-card-top">
            <span class="dc-tone">${escapeHtml(TONE_LABELS[s.tone] || s.tone)}</span>
            <button class="dc-copy">Копировать</button>
          </div>
          <div class="dc-msg">${escapeHtml(s.message)}</div>
          ${s.rationale ? `<div class="dc-why">${escapeHtml(s.rationale)}</div>` : ""}
        </div>`
      )
      .join("");

    if (!cards) {
      $("#dc-results").innerHTML =
        engineNote +
        insight +
        `<div class="dc-err">Бэкенд вернул пустой ответ. Проверь, что сервер запущен (launch.ps1).</div>`;
      return;
    }

    $("#dc-results").innerHTML = engineNote + insight + cards;

    panel.querySelectorAll(".dc-copy").forEach((btn, i) => {
      btn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(data.suggestions[i].message);
        btn.textContent = "Скопировано ✓";
        btn.classList.add("dc-copied");
        setTimeout(() => {
          btn.textContent = "Копировать";
          btn.classList.remove("dc-copied");
        }, 1500);
      });
    });
  }

  // ---------- auto-open & navigation ----------
  let userDismissed = false; // set when the user explicitly closes the panel
  let lastUrl = location.href;

  // Best-effort check: are we looking at an actual chat (not just a list)?
  function looksLikeChat() {
    try {
      const { messages } = window.DatingChad.pickAdapter().scrape();
      if (messages && messages.length) return true;
    } catch {}
    // A message composer usually means a chat is open.
    const composer = document.querySelector(
      "[contenteditable='true'], textarea[placeholder*='essage'], textarea[placeholder*='ay' i], input[placeholder*='essage']"
    );
    return !!composer;
  }

  // Opens the panel and scrapes the page, but NEVER auto-generates.
  // Suggestions are produced only when the user clicks the "Подсказать" button.
  function openPanel() {
    panel.classList.remove("dc-hidden");
    scrapePage({ preserveResults: false });
  }

  function autoRun() {
    if (userDismissed) return;
    if (!looksLikeChat()) return;
    openPanel();
  }

  // Dating apps are single-page apps, so we watch for in-app navigation.
  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    userDismissed = false; // a new chat → allow auto-open again
    setTimeout(autoRun, 900);
  }
  const _push = history.pushState;
  history.pushState = function () {
    _push.apply(this, arguments);
    onNavigate();
  };
  const _replace = history.replaceState;
  history.replaceState = function () {
    _replace.apply(this, arguments);
    onNavigate();
  };
  window.addEventListener("popstate", onNavigate);
  setInterval(onNavigate, 1500); // fallback for routers that bypass the History API

  // ---------- events ----------
  fab.addEventListener("click", () => {
    if (panel.classList.contains("dc-hidden")) {
      userDismissed = false;
      openPanel();
    } else {
      panel.classList.add("dc-hidden");
      userDismissed = true;
    }
  });
  $(".dc-close").addEventListener("click", () => {
    panel.classList.add("dc-hidden");
    userDismissed = true;
  });
  $("#dc-rescrape").addEventListener("click", () => scrapePage({ preserveResults: true }));
  $("#dc-go").addEventListener("click", suggest);
  $("#dc-save-tones").addEventListener("click", saveTones);
  $("#dc-transcript").addEventListener("input", updateGoalLabel);

  // Re-scrape profile when DOM changes, but never wipe suggestions.
  let rescrapeTimer = null;
  let suggesting = false;
  function scheduleProfileRescrape() {
    if (panel.classList.contains("dc-hidden") || suggesting) return;
    clearTimeout(rescrapeTimer);
    rescrapeTimer = setTimeout(() => scrapePage({ preserveResults: true }), 800);
  }
  new MutationObserver(scheduleProfileRescrape).observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial auto-open once the SPA has had a moment to render.
  setTimeout(autoRun, 1600);
})();
