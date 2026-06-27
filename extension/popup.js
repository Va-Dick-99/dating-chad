const ALL_TONES = ["playful", "sincere", "witty", "flirty", "funny"];
const TONE_LABELS = {
  playful: "игривый",
  sincere: "искренний",
  witty: "остроумный",
  flirty: "флиртующий",
  funny: "смешной",
};
const DEFAULTS = { backendUrl: "http://127.0.0.1:8000", tones: ["playful", "sincere", "witty"] };

const $ = (id) => document.getElementById(id);

function renderTones(selected) {
  const wrap = $("tones");
  wrap.innerHTML = "";
  ALL_TONES.forEach((t) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${t}" ${selected.includes(t) ? "checked" : ""}/> ${TONE_LABELS[t] || t}`;
    wrap.appendChild(label);
  });
}

chrome.storage.local.get(DEFAULTS, (local) => {
  chrome.storage.sync.get(DEFAULTS, (sync) => {
    const cfg = { ...DEFAULTS, ...sync, ...local };
    $("backendUrl").value = cfg.backendUrl;
    renderTones(cfg.tones);
  });
});

$("save").addEventListener("click", () => {
  const backendUrl = $("backendUrl").value.trim() || DEFAULTS.backendUrl;
  const tones = [...document.querySelectorAll("#tones input:checked")].map((c) => c.value);
  const data = { backendUrl, tones: tones.length ? tones : DEFAULTS.tones };
  chrome.storage.local.set(data, () => {
    chrome.storage.sync.set(data, () => {
      const s = $("status");
      s.textContent = "Сохранено ✓";
      s.className = "status ok";
      setTimeout(() => (s.textContent = ""), 1500);
    });
  });
});
