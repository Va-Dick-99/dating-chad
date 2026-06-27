const $ = (id) => document.getElementById(id);

async function loadHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    const badge = $("engineBadge");
    if (data.engine === "llm") {
      badge.textContent = `🤖 ${data.model}`;
      badge.title = "AI engine active";
    } else {
      badge.textContent = "⚙️ heuristic mode";
      badge.title = "No API key set — using built-in heuristics. Add OPENAI_API_KEY for AI suggestions.";
    }
  } catch {
    $("engineBadge").textContent = "offline";
  }
}

function selectedTones() {
  return [...document.querySelectorAll(".tones input:checked")].map((c) => c.value);
}

function buildProfile() {
  const interests = $("interests").value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ageVal = parseInt($("age").value, 10);
  const profile = {
    name: $("name").value.trim() || null,
    age: Number.isNaN(ageVal) ? null : ageVal,
    bio: $("bio").value.trim() || null,
    interests,
    app: $("app").value || null,
  };
  const hasData = profile.name || profile.bio || interests.length || profile.age || profile.app;
  return hasData ? profile : null;
}

function tag(text) {
  const s = document.createElement("span");
  s.className = "tag";
  s.textContent = text;
  return s;
}

function row(label, value) {
  if (!value) return "";
  return `<div class="insight-row"><b>${label}:</b> ${escapeHtml(value)}</div>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function renderProfileInsights(p) {
  const el = $("profileInsights");
  el.innerHTML =
    row("Vibe", p.vibe) +
    (p.interests?.length ? `<div class="insight-row"><b>Interests:</b><div class="tags"></div></div>` : "") +
    (p.conversation_hooks?.length
      ? `<div class="insight-row"><b>Hooks:</b><ul>${p.conversation_hooks.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul></div>`
      : "") +
    row("Notes", p.compatibility_notes);
  if (p.interests?.length) {
    const tags = el.querySelector(".tags");
    p.interests.forEach((i) => tags.appendChild(tag(i)));
  }
}

function renderConvoInsights(c) {
  const el = $("convoInsights");
  const flags = (arr, cls, icon) =>
    (arr || []).map((f) => `<div class="insight-row ${cls}">${icon} ${escapeHtml(f)}</div>`).join("");
  el.innerHTML =
    row("Whose turn", c.whose_turn) +
    row("Sentiment", c.sentiment) +
    row("Engagement", c.engagement) +
    flags(c.green_flags, "flag-ok", "✅") +
    flags(c.red_flags, "flag-warn", "⚠️") +
    row("Summary", c.summary);
}

function renderSuggestions(list) {
  const wrap = $("suggestions");
  wrap.innerHTML = "";
  (list || []).forEach((s) => {
    const card = document.createElement("div");
    card.className = "suggestion";
    card.innerHTML = `
      <div class="toneline">
        <span class="tone-badge">${escapeHtml(s.tone)}</span>
        <button class="copy-btn">Copy</button>
      </div>
      <div class="msg">${escapeHtml(s.message)}</div>
      <div class="why">${escapeHtml(s.rationale || "")}</div>`;
    const btn = card.querySelector(".copy-btn");
    btn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(s.message);
      btn.textContent = "Copied ✓";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1500);
    });
    wrap.appendChild(card);
  });
}

async function getSuggestions() {
  const btn = $("go");
  const tones = selectedTones();
  if (tones.length === 0) {
    alert("Pick at least one tone.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Thinking…";

  const payload = {
    profile: buildProfile(),
    transcript: $("transcript").value,
    goal: $("goal").value,
    tone: tones,
    about_me: $("aboutMe").value.trim() || null,
  };

  try {
    const res = await fetch("/api/suggest-from-transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    renderProfileInsights(data.profile_insights || {});
    renderConvoInsights(data.conversation_insights || {});
    renderSuggestions(data.suggestions || []);
    $("results").classList.remove("hidden");
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    $("suggestions").innerHTML = `<div class="error">Something went wrong: ${escapeHtml(e.message)}</div>`;
    $("results").classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Get suggestions ✨";
  }
}

$("go").addEventListener("click", getSuggestions);
loadHealth();
