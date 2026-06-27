// Site adapters: scrape the open chat + visible profile from dating-app pages.
//
// IMPORTANT: Dating apps obfuscate and frequently rotate their CSS class names,
// so DOM scraping is inherently best-effort. Each adapter lists several candidate
// selectors and we fall back to a position-based heuristic to decide who sent
// each message (bubbles aligned to the right of the chat = "me"). The content
// script always shows an EDITABLE transcript so you can fix any mistakes before
// asking for suggestions.

(function () {
  function text(el) {
    return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function firstMatch(selectors, root = document) {
    for (const sel of selectors) {
      const nodes = root.querySelectorAll(sel);
      if (nodes.length) return [...nodes];
    }
    return [];
  }

  // True for the live message bubbles AND the surrounding Badoo chat-view UI
  // chrome that is NOT real profile data: the nav strip, the mini-profile
  // *user-info* summary (name/age/city/match-banner), date pills, read-receipt
  // status, and screen-reader-only (a11y) duplicate text. Folding the chrome in
  // here makes every existing profile harvester that already guards with
  // isInChatMessages (scrapeRootsWithoutChat, scrapeDomPairs, findProfileScope,
  // the headerEls/prompt loops) skip this chrome too. NOTE: it deliberately
  // matches the suffixed "mini-profile-user-info"/"mini-profile__user-info" and
  // NOT bare "mini-profile", so the photo gallery (mini-profile__gallery) and
  // collectPhotos are unaffected. scrapeMessages/classify do NOT call this, so
  // message scraping is untouched.
  function isInChatMessages(el) {
    return !!el.closest(
      '[class*="messages-list"], [class*="message-list"], [role="log"], [class*="chat-message"], ' +
        '[class*="navigation-bar"], [class*="mini-profile-user-info"], [class*="mini-profile__user-info"], ' +
        '[class*="chat-date"], [class*="message-item-status"], [class*="a11y-visually-hidden"], ' +
        '[class*="chat-footer"], [class*="chat-controls"], [class*="chat-composer"], [class*="tabbar"]'
    );
  }

  function extractChips(root) {
    if (!root) return [];
    const chips = [
      ...root.querySelectorAll(
        '[class*="chip"], [class*="tag"], [class*="badge"], [class*="pill"], button, li, span'
      ),
    ];
    const out = [];
    const seen = new Set();
    for (const el of chips) {
      const t = text(el);
      if (!t || t.length < 2 || t.length > 60) continue;
      if (/^(да|нет|yes|no)$/i.test(t)) continue;
      if (seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push(t);
    }
    return out;
  }

  function extractAfterHeader(block, header) {
    if (!block || !header) return "";
    const full = text(block);
    const label = text(header);
    if (full.startsWith(label)) return full.slice(label.length).trim().slice(0, 300);
    return full.replace(label, "").trim().slice(0, 300);
  }

  // Walk section headings (RU/UK) and pull structured profile fields.
  const NOISE_LINE =
    /^(отправить|сообщение|type a message|твоё сообщение|твоё|симпатия|match|назад|закрыть|close|report|пожаловаться|интересы$|главное$|активация windows|открыть профиль|open profile|подсказать|пересканировать)/i;

  // Chat-header UI chrome (EN + RU) that can still leak into a profile "detail".
  // Anchored to the WHOLE token where it matters: bare labels/ages only match
  // when the entire token is that label/age, so real values like "Работаю в
  // Google" or "25 лет в IT" survive. Generalized — no hardcoded city/name.
  const NOISE_DETAIL =
    /^(открыть профиль|open profile|view profile|симпатия|match|liked you|verified profile|назад|back|закрыть|close|education|образование|work|работа|you'?ve matched|you matched.*ago|вы совпали.*|has .+ seen.*|online.*ago|онлайн.*|,?\s*\d{1,3}(\s+years old)?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s*\d{4})\s*$/i;

  // Composite chrome anywhere inside a token, e.g. the screen-reader strings
  // "Work: Odesa" / "Odesa Work: Odesa" / "You matched 5 days ago". Requires the
  // "Work:"/"Education:" label+colon+space form so normal prose is unaffected.
  const NOISE_DETAIL_CONTAINS =
    /(\bwork:\s|\beducation:\s|открыть профиль|open profile|you'?ve matched|matched .*ago)/i;

  function isLikelyLabel(line) {
    const l = line.toLowerCase().trim();
    if (!l || l.length > 90 || NOISE_LINE.test(l)) return false;
    return (
      l.includes("?") ||
      /^(о себе|about|про себе|работа|work|образование|education|интересы|interests|главное|цель|goal|чего хочет|languages|языки)/.test(l) ||
      /^(чему|как ты|what|how do you|currently)/.test(l)
    );
  }

  function categorizeLabelAnswer(label, value, profile) {
    if (!value || value === label || value.length > 400) return;
    const l = label.toLowerCase().trim();
    const v = value.trim();
    // Reject Badoo chat-view chrome leaking in as a "value" — e.g. an English
    // "Education"/"Work" label paired with the match banner ("You matched 5 days
    // ago") or "Open Profile". Harvesters reading the bare mini-profile ancestor
    // pull these via innerText; the value-side filter stops them at the source.
    if (NOISE_DETAIL.test(v) || NOISE_DETAIL_CONTAINS.test(v)) return;
    if (/^о себе|about me|про себе/.test(l)) profile.bio = v;
    else if (/^работа$|^work$/.test(l)) profile.work = v;
    else if (/^образование|education/.test(l)) profile.education = v;
    else if (/^интерес/.test(l)) {
      profile.interests.push(...v.split(/[,·•]/).map((s) => s.trim()).filter(Boolean));
    } else if (/^главное|basics|основн/.test(l)) profile.details.push(v);
    else if (/^цель|goal|чего хочет|looking/.test(l)) profile.goal = v;
    else if (l.includes("?") || /^(чему|как ты|what|how)/.test(l)) profile.prompts.push(`${label} → ${v}`);
    else if (l.length < 45 && v.length > 1) profile.prompts.push(`${label} → ${v}`);
  }

  function mergeProfile(into, from) {
    if (!from) return;
    if (from.name && !into.name) into.name = from.name;
    if (from.age && !into.age) into.age = from.age;
    if (from.bio && (!into.bio || from.bio.length > into.bio.length)) into.bio = from.bio;
    if (from.work && !into.work) into.work = from.work;
    if (from.education && !into.education) into.education = from.education;
    if (from.goal && !into.goal) into.goal = from.goal;
    into.interests = [...new Set([...(into.interests || []), ...(from.interests || [])])];
    into.prompts = [...new Set([...(into.prompts || []), ...(from.prompts || [])])];
    const details = [...new Set([...(into.details || []), ...(from.details || [])])].filter(
      (d) =>
        d &&
        d.length > 1 &&
        d.length < 80 &&
        !NOISE_DETAIL.test(d.trim()) &&
        !NOISE_DETAIL_CONTAINS.test(d.trim()) &&
        (!into.name || d.trim() !== into.name)
    );
    into.details = details;
  }

  function profileScore(p) {
    if (!p) return 0;
    return (
      (p.bio ? 20 : 0) +
      (p.work ? 8 : 0) +
      (p.education ? 4 : 0) +
      (p.prompts?.length || 0) * 6 +
      (p.interests?.length || 0) * 2
    );
  }

  function mergeBestProfile(into, candidates) {
    let best = null;
    let bestScore = profileScore(into);
    for (const c of candidates) {
      const s = profileScore(c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best) mergeProfile(into, best);
  }

  // Badoo renders profile as grey label line + bold answer line (see screenshots).
  function scrapeLinePairs(root) {
    const profile = { interests: [], prompts: [], details: [] };
    if (!root) return profile;
    const lines = (root.innerText || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !NOISE_LINE.test(s));

    for (let i = 0; i < lines.length; i++) {
      const label = lines[i];
      if (!isLikelyLabel(label)) continue;

      const valueParts = [];
      while (i + 1 < lines.length && !isLikelyLabel(lines[i + 1])) {
        i++;
        valueParts.push(lines[i]);
      }
      const value = valueParts.join(" ").trim();
      if (value) categorizeLabelAnswer(label, value, profile);
    }
    return profile;
  }

  function scrapeRootsWithoutChat() {
    const roots = [];
    const chat = document.querySelector(
      '[class*="messages-list"], [class*="message-list"], [role="log"]'
    );
    for (const el of document.querySelectorAll(
      "main, aside, [role='dialog'], [class*='profile'], [class*='overlay'], [class*='sheet']"
    )) {
      if (isInChatMessages(el)) continue;
      if (chat && chat.contains(el)) continue;
      roots.push(el);
    }
    return roots.length ? roots : [document.body];
  }

  // DOM: label child + one or more value siblings (Badoo often nests bold answer).
  function scrapeDomPairs(root) {
    const profile = { interests: [], prompts: [], details: [] };
    if (!root) return profile;
    for (const el of root.querySelectorAll("div, section, li, article, dl, p")) {
      if (isInChatMessages(el)) continue;
      const kids = [...el.children].filter((c) => text(c).length > 0);
      if (kids.length < 2) continue;
      const label = text(kids[0]);
      const value = kids
        .slice(1)
        .map((c) => text(c))
        .filter(Boolean)
        .join(" ");
      if (isLikelyLabel(label) && value && !isLikelyLabel(value)) categorizeLabelAnswer(label, value, profile);
    }
    for (const dl of root.querySelectorAll("dl")) {
      if (isInChatMessages(dl)) continue;
      const dts = dl.querySelectorAll("dt");
      const dds = dl.querySelectorAll("dd");
      dts.forEach((dt, idx) => {
        const label = text(dt);
        const value = text(dds[idx]);
        if (label && value) categorizeLabelAnswer(label, value, profile);
      });
    }
    return profile;
  }

  function findProfileScope() {
    const candidates = [
      ...document.querySelectorAll(
        '[role="dialog"], [class*="profile-sheet"], [class*="ProfileModal"], [class*="user-profile"], [class*="profile-card"], [class*="profile-info"], [class*="overlay"], aside'
      ),
    ].filter((el) => {
      if (isInChatMessages(el)) return false;
      const t = (el.innerText || "").toLowerCase();
      return (
        t.length > 40 &&
        (/о себе|about|интерес|учишься|забот|прокраст|ембів|скарб|пофіг|психодел/i.test(t) ||
          el.getAttribute("role") === "dialog" ||
          el.querySelector("h1, h2"))
      );
    });
    if (!candidates.length) return null;
    return candidates.sort((a, b) => (b.innerText || "").length - (a.innerText || "").length)[0];
  }

  function scrapeBadooProfileExtra(base) {
    const candidates = [];
    const scope = findProfileScope();
    if (scope) {
      candidates.push(scrapeLinePairs(scope));
      candidates.push(scrapeDomPairs(scope));
    }
    for (const root of scrapeRootsWithoutChat()) {
      candidates.push(scrapeLinePairs(root));
    }
    mergeBestProfile(base, candidates);
    if (scope) mergeProfile(base, scrapeDomPairs(scope));
  }

  function scrapeStructuredProfile() {
    const profile = {
      interests: [],
      prompts: [],
      details: [],
      sections: [],
    };

    const nameEl =
      document.querySelector('[class*="profile"] h1, [class*="Profile"] h1, h1') ||
      document.querySelector('[class*="name"]');
    const nameRaw = text(nameEl);
    if (nameRaw) {
      profile.name = nameRaw.split(",")[0].trim();
      const ageM = nameRaw.match(/,\s*(\d{1,3})/);
      if (ageM) profile.age = parseInt(ageM[1], 10);
    }
    // Badoo's chat header keeps the age in a sibling node (e.g.
    // <span data-qa="profile-info__age">25</span>), not inside the name h1, so
    // the "Имя, 25" comma-parse above misses it. Fall back to the dedicated age
    // element. Bounded 18-120 so it can't grab stray numbers; only runs when age
    // is still undefined, so it never overrides a real parse.
    if (!profile.age) {
      const ageEl = document.querySelector(
        '[data-qa="profile-info__age"], [class*="profile-info__age"]'
      );
      const ageNum = parseInt(text(ageEl).replace(/[^\d]/g, ""), 10);
      if (ageNum >= 18 && ageNum <= 120) profile.age = ageNum;
    }

    const headerEls = [
      ...document.querySelectorAll("h2, h3, h4, dt, [class*='title'], [class*='heading'], [class*='label']"),
    ].filter((el) => !isInChatMessages(el));

    for (const h of headerEls) {
      const label = text(h).toLowerCase();
      if (!label || label.length > 80) continue;
      const block =
        h.closest("section, [class*='section'], [class*='block'], [class*='row'], li, dl") ||
        h.parentElement;
      if (!block || isInChatMessages(block)) continue;

      if (/о себе|about me|про себе/.test(label)) {
        profile.bio = extractAfterHeader(block, h);
      } else if (/интерес/.test(label)) {
        profile.interests.push(...extractChips(block));
      } else if (/^работ/.test(label) || label === "работа") {
        profile.work = extractAfterHeader(block, h);
      } else if (/образован/.test(label)) {
        profile.education = extractAfterHeader(block, h);
      } else if (/главное|basics|основн/.test(label)) {
        profile.details.push(...extractChips(block));
      } else if (/цель|looking for|шука/.test(label)) {
        profile.goal = extractAfterHeader(block, h);
      } else if (label.includes("?") || /\?$/.test(text(h))) {
        const ans = extractAfterHeader(block, h);
        if (ans && ans.length > 1) profile.prompts.push(`${text(h)} → ${ans}`);
      }
    }

    // Prompt cards: question line + answer line (Badoo/Hinge style).
    for (const card of document.querySelectorAll(
      "[class*='prompt'], [class*='question'], [class*='answer'], [class*='profile-card']"
    )) {
      if (isInChatMessages(card)) continue;
      const lines = (card.innerText || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length >= 2 && (lines[0].includes("?") || lines[0].length < 80)) {
        profile.prompts.push(`${lines[0]} → ${lines[1]}`);
      }
    }

    // Chat header strip (work/education tags visible without opening full profile).
    const headerRoots = document.querySelectorAll(
      '[class*="chat-header"], [class*="conversation-header"], [class*="profile-bar"], [class*="user-info"], [class*="match-bar"]'
    );
    for (const root of headerRoots) {
      // This loop pushes straight to profile.work/details and bypasses
      // mergeProfile's filter, so it must reject Badoo's chat-view chrome itself:
      // skip chrome subtrees (mini-profile-user-info, nav, match-banner, a11y
      // echoes) AND drop any chrome tokens that slip through.
      if (isInChatMessages(root)) continue;
      for (const t of extractChips(root)) {
        const tt = t.trim();
        if (profile.details.includes(t)) continue;
        if (NOISE_DETAIL.test(tt) || NOISE_DETAIL_CONTAINS.test(tt)) continue;
        if (profile.name && tt === profile.name) continue;
        if (!profile.work && /прокраст|работ|work|фриланс|офис/i.test(t)) profile.work = t;
        else if (!profile.education && /школ|универ|магист|образ|college|uni/i.test(t))
          profile.education = t;
        else profile.details.push(t);
      }
    }

    // Fallback: interest tags anywhere outside chat.
    if (profile.interests.length === 0) {
      for (const el of document.querySelectorAll('[class*="interest"], [class*="tag-list"] *')) {
        if (isInChatMessages(el)) continue;
        const t = text(el);
        if (t && t.length > 2 && t.length < 40) profile.interests.push(t);
      }
      profile.interests = [...new Set(profile.interests)].slice(0, 12);
    }

    return profile;
  }

  function profileToText(p) {
    if (!p) return "";
    const lines = [];
    if (p.name) lines.push(p.name + (p.age ? `, ${p.age}` : ""));
    if (p.bio) lines.push(`О себе: ${p.bio}`);
    if (p.goal) lines.push(`Цель: ${p.goal}`);
    if (p.work) lines.push(`Работа: ${p.work}`);
    if (p.education) lines.push(`Образование: ${p.education}`);
    if (p.interests?.length) lines.push(`Интересы: ${[...new Set(p.interests)].join(", ")}`);
    if (p.prompts?.length) {
      lines.push("Промпты:");
      [...new Set(p.prompts)].slice(0, 8).forEach((pr) => lines.push(`  • ${pr}`));
    }
    if (p.details?.length) lines.push(`Детали: ${[...new Set(p.details)].slice(0, 12).join("; ")}`);
    return lines.join("\n").trim();
  }

  // Prefer profile-area photos over random page images.
  function collectPhotos(max = 4) {
    const roots = [
      ...document.querySelectorAll(
        '[class*="profile"], [class*="photo"], [class*="gallery"], [class*="avatar"], [class*="encounters"]'
      ),
    ].filter((r) => !isInChatMessages(r));
    const scope = roots.length ? roots : [document.body];

    const imgs = [];
    for (const root of scope) imgs.push(...root.querySelectorAll("img"));

    const filtered = imgs
      .filter((im) => {
        const src = im.currentSrc || im.src || "";
        if (!/^https?:/.test(src)) return false;
        if (/icon|logo|emoji|badge|1x1|pixel|svg/i.test(src)) return false;
        const w = im.naturalWidth || im.width || 0;
        const h = im.naturalHeight || im.height || 0;
        return w >= 100 && h >= 100;
      })
      .sort(
        (a, b) =>
          (b.naturalWidth || b.width) * (b.naturalHeight || b.height) -
          (a.naturalWidth || a.width) * (a.naturalHeight || a.height)
      );

    const seen = new Set();
    const out = [];
    for (const im of filtered) {
      const src = im.currentSrc || im.src;
      if (seen.has(src)) continue;
      seen.add(src);
      out.push(src);
      if (out.length >= max) break;
    }
    return out;
  }

  // Classify a bubble as "me" or "them" using horizontal alignment within its
  // chat container. Works across sites regardless of class names.
  function classifyByPosition(el, container) {
    try {
      const b = el.getBoundingClientRect();
      const c = (container || el.parentElement).getBoundingClientRect();
      const center = c.left + c.width / 2;
      const bubbleCenter = b.left + b.width / 2;
      return bubbleCenter > center ? "me" : "them";
    } catch {
      return "them";
    }
  }

  // Try class-name hints first (most reliable when present), else position.
  function classify(el, container) {
    const cls = (el.className || "").toString().toLowerCase();
    const hint = (el.getAttribute?.("data-sender") || el.getAttribute?.("aria-label") || "").toLowerCase();
    const blob = cls + " " + hint;
    if (/\b(out|own|self|sent|mine|sender--me|message--out)\b/.test(blob)) return "me";
    if (/\b(in|their|received|other|sender--them|message--in)\b/.test(blob)) return "them";
    return classifyByPosition(el, container);
  }

  function scrapeMessages(containerSelectors, bubbleSelectors) {
    const container = firstMatch(containerSelectors)[0] || document.body;
    let bubbles = firstMatch(bubbleSelectors, container);
    if (!bubbles.length) bubbles = firstMatch(bubbleSelectors); // try whole doc

    // Keep only the innermost matches: if a matched element contains another
    // matched element, it's a wrapper duplicating the same text — drop it.
    bubbles = bubbles.filter(
      (el) => !bubbles.some((other) => other !== el && el.contains(other))
    );

    const messages = [];
    let lastKey = "";
    for (const el of bubbles) {
      const t = text(el);
      if (!t || t.length > 800) continue;
      const sender = classify(el, container);
      const key = sender + "|" + t;
      if (key === lastKey) continue; // skip immediate duplicate (scraping artifact)
      lastKey = key;
      messages.push({ sender, text: t });
    }
    return messages;
  }

  const ADAPTERS = {
    badoo: {
      test: (h) => h.includes("badoo."),
      app: "badoo",
      scrape() {
        const messages = scrapeMessages(
          [".messages-list", "[class*='messages']", "[role='log']", "main"],
          [
            ".message__content",
            ".chat-message__bubble",
            "[class*='message-bubble']",
            "[class*='message__text']",
            "[class*='bubble']",
          ]
        );
        const structured = scrapeStructuredProfile();
        const legacyBio = firstMatch([
          "[class*='profile'] [class*='about']",
          "[class*='bio']",
          "[class*='profile-section']",
        ])
          .map(text)
          .join(" ")
          .slice(0, 600);
        if (!structured.bio && legacyBio) structured.bio = legacyBio;
        if (!structured.name) {
          structured.name = text(firstMatch(["[class*='profile'] h1", "h1", "[class*='name']"])[0]);
        }
        structured.app = "badoo";
        scrapeBadooProfileExtra(structured);
        structured.bioText = profileToText(structured);
        return { profile: structured, messages, photos: collectPhotos() };
      },
    },

    tinder: {
      test: (h) => h.includes("tinder."),
      app: "tinder",
      scrape() {
        const messages = scrapeMessages(
          [".msgList", "[class*='msgList']", "[role='log']", "main"],
          [".msg", "[class*='msg'] span", "[class*='message'] span", "[class*='bubble']"]
        );
        const bio = firstMatch([
          "[class*='Bio']",
          "[itemprop='description']",
          "[class*='profileCard'] [class*='about']",
        ]).map(text).join(" ").slice(0, 600);
        const name = text(firstMatch(["h1", "[class*='name']", "[itemprop='name']"])[0]);
        return { profile: { name, bio, app: "tinder" }, messages, photos: collectPhotos() };
      },
    },

    bumble: {
      test: (h) => h.includes("bumble."),
      app: "bumble",
      scrape() {
        const messages = scrapeMessages(
          ["[class*='messages']", "[role='log']", "main"],
          ["[class*='message-bubble']", "[class*='bubble']", "[class*='message__text']"]
        );
        return { profile: { app: "bumble" }, messages, photos: collectPhotos() };
      },
    },

    hinge: {
      test: (h) => h.includes("hinge."),
      app: "hinge",
      scrape() {
        const messages = scrapeMessages(
          ["[class*='messages']", "[role='log']", "main"],
          ["[class*='bubble']", "[class*='message']"]
        );
        return { profile: { app: "hinge" }, messages, photos: collectPhotos() };
      },
    },

    generic: {
      test: () => true,
      app: null,
      scrape() {
        const messages = scrapeMessages(
          ["[role='log']", "[class*='messages']", "[class*='chat']", "main"],
          ["[class*='bubble']", "[class*='message']", "li"]
        );
        return { profile: {}, messages, photos: collectPhotos() };
      },
    },
  };

  function pick() {
    const host = location.hostname;
    for (const key of ["badoo", "tinder", "bumble", "hinge"]) {
      if (ADAPTERS[key].test(host)) return ADAPTERS[key];
    }
    return ADAPTERS.generic;
  }

  window.DatingChad = { pickAdapter: pick, adapters: ADAPTERS };
})();
