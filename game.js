/* ===== Папки суду · екран гри =====
   Екран — єдине джерело стану. Пульт надсилає команди, екран застосовує їх
   і транслює повний знімок стану у відповідь. */
(function () {
  "use strict";
  const { CASES, BADGES } = window.SUD;
  const Sync = window.SudSync;
  const LS_KEY = "sud-papky-state-v1";
  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const byId = (id) => CASES.find((c) => c.id === id);

  /* ---------- стан ---------- */
  function defaults() {
    return {
      screen: "table",   // table | case | end
      caseId: null,
      step: 1,           // 1 прохання · 2 відзначити · 3 перепитати · 4 вердикт
      round: [],         // бейджі, видані в поточному раунді (показані на екрані)
      hint: false,       // м'яка підказка після «Ще спроба»
      closed: [],        // закриті справи
      results: {},       // { [id]: { badges: [], held: bool } }
      sound: false,
      room: null,        // код кімнати (Firebase), якщо ввімкнено
      rev: 0
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaults();
      return Object.assign(defaults(), JSON.parse(raw));
    } catch (_) { return defaults(); }
  }
  let S = load();
  if (S.screen === "case" && !byId(S.caseId)) { S.screen = "table"; S.caseId = null; }

  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (_) {} }

  /* ---------- зв'язок ---------- */
  let lastPultSeen = 0;
  const seenCmd = new Set();
  const channel = Sync.openChannel(onMessage);

  function snapshot() {
    return {
      screen: S.screen, caseId: S.caseId, step: S.step,
      round: S.round.slice(), hint: S.hint,
      closed: S.closed.slice(), results: S.results,
      sound: S.sound, room: S.room, rev: S.rev,
      fb: Sync.fbEnabled(), t: Date.now()
    };
  }
  let fbTimer = null;
  function broadcast() {
    const snap = snapshot();
    channel.post({ from: "screen", type: "state", state: snap });
    if (Sync.fbEnabled() && S.room) {
      clearTimeout(fbTimer);
      fbTimer = setTimeout(() => Sync.fbPut("rooms/" + S.room + "/state", snap), 80);
    }
  }
  function commit() { S.rev++; save(); broadcast(); }

  function onMessage(msg) {
    if (!msg || msg.from !== "pult") return;
    lastPultSeen = Date.now();
    updateDot();
    if (msg.type === "hello" || msg.type === "ping") { broadcast(); return; }
    if (msg.type === "bye") { lastPultSeen = 0; updateDot(); return; }
    if (msg.type === "cmd") {
      if (msg.id) {
        if (seenCmd.has(msg.id)) return;
        seenCmd.add(msg.id);
      }
      runCommand(msg.cmd, msg.arg);
    }
  }

  /* Firebase: кімната з кодом на 4 цифри (необов'язково) */
  if (Sync.fbEnabled()) {
    if (!S.room) { S.room = Sync.newRoomCode(); save(); }
    const base = "rooms/" + S.room;
    Sync.fbPut(base + "/meta", { createdAt: { ".sv": "timestamp" } });
    Sync.fbPut(base + "/cmd", null).then(() => {
      Sync.fbListen(base + "/cmd", (data) => { if (data) onMessage(data); });
      broadcast();
    });
  }

  function updateDot() {
    const on = Date.now() - lastPultSeen < 7000;
    $("pult-dot").classList.toggle("on", on);
    document.body.classList.toggle("pult-on", on);
  }
  setInterval(updateDot, 1000);

  const hintEl = $("corner-hint");
  if (Sync.fbEnabled() && S.room) {
    hintEl.textContent = "Відкрийте пульт у сусідній вкладці або на телефоні: код " + S.room;
  }
  $("pult-link").href = "pult.html" + (S.room ? "?room=" + S.room : "");

  /* ---------- команди ---------- */
  function runCommand(cmd, arg) {
    unlockAudio();
    switch (cmd) {
      case "open": openCase(Number(arg)); break;
      case "random": openRandom(); break;
      case "step": gotoStep(Number(arg)); break;
      case "next": next(); break;
      case "badge": giveBadge(arg); break;
      case "retry": retry(); break;
      case "reask": gotoStep(3); break;
      case "verdict": verdict(); break;
      case "rewind": rewind(); break;
      case "table": toTable(); break;
      case "end": endSession(); break;
      case "newLesson": newLesson(); break;
      case "sound": S.sound = !!arg; commit(); if (S.sound) playSound("rustle"); break;
    }
  }

  function openCase(id, origin) {
    const c = byId(id);
    if (!c) return;
    S.screen = "case"; S.caseId = id; S.step = 1; S.round = []; S.hint = false;
    if (!S.results[id]) S.results[id] = { badges: [], held: false };
    commit();
    renderCase({ open: true, origin, type: "ask" });
    playSound("rustle");
  }
  function openRandom() {
    const left = CASES.filter((c) => !S.closed.includes(c.id));
    const pool = left.length ? left : CASES;
    openCase(pool[Math.floor(Math.random() * pool.length)].id);
  }

  function gotoStep(n) {
    if (S.screen !== "case") return;
    if (n === 4) return verdict();
    if (S.step === 4) unclose();
    const prev = S.step;
    S.hint = false;
    if (n === 1) { S.step = 1; S.round = []; commit(); renderCase({ type: "ask" }); return; }
    if (n === 2) {
      S.step = 2;
      if (prev >= 3) S.round = [];
      commit(); renderCase({ type: prev >= 3 ? "askInstant" : null });
      return;
    }
    if (n === 3) {
      if (prev === 3) { commit(); return; }
      S.step = 3; S.round = []; commit(); renderCase({ type: "reask" }); return;
    }
  }

  function next() {
    if (S.screen === "case") {
      if (S.step < 4) gotoStep(S.step + 1);
      else toTable();
    } else if (S.screen === "end") {
      toTable();
    }
  }

  function giveBadge(key) {
    if (S.screen !== "case" || S.step === 4 || !BADGES[key]) return;
    if (S.step === 1) S.step = 2;
    S.hint = false;
    const r = S.results[S.caseId] || (S.results[S.caseId] = { badges: [], held: false });
    if (!r.badges.includes(key)) r.badges.push(key);
    const fresh = !S.round.includes(key);
    if (fresh) S.round.push(key);
    commit();
    renderBadges(key);
    if (fresh) playSound("pop");
  }

  function retry() {
    if (S.screen !== "case" || S.step === 4) return;
    const back = S.step >= 3 ? 3 : 1;
    S.step = back; S.round = []; S.hint = true;
    commit();
    renderCase({ type: back === 3 ? "reask" : "ask" });
  }

  function verdict() {
    if (S.screen !== "case" || S.step === 4) return;
    const r = S.results[S.caseId] || (S.results[S.caseId] = { badges: [], held: false });
    if (S.step >= 3) r.held = true;
    S.step = 4; S.hint = false;
    if (!S.closed.includes(S.caseId)) S.closed.push(S.caseId);
    S.lastClosed = S.caseId;
    commit();
    renderCase({ verdict: true });
  }

  function unclose() {
    S.closed = S.closed.filter((id) => id !== S.caseId);
    if (S.lastClosed === S.caseId) S.lastClosed = null;
  }

  /* «Перемотати»: на крок назад, без жодного «програшу» */
  function rewind() {
    if (S.screen !== "case") return;
    if (S.step === 4) {
      unclose();
      const r = S.results[S.caseId];
      const fromReask = r && r.held;
      if (r) r.held = false;
      S.step = fromReask ? 3 : 2; S.hint = false;
      commit(); renderCase({ type: fromReask ? "reaskInstant" : "askInstant" });
    } else if (S.step === 3) {
      S.step = 2; S.round = []; S.hint = false; commit(); renderCase({ type: "askInstant" });
    } else {
      S.step = 1; S.round = []; S.hint = false; commit(); renderCase({ type: "ask" });
    }
  }

  function toTable() {
    stopTyping();
    S.screen = "table"; S.caseId = null; S.step = 1; S.round = []; S.hint = false;
    commit();
    render();
    S.lastClosed = null;
    save();
  }
  function endSession() {
    stopTyping();
    S.screen = "end"; S.caseId = null; S.step = 1; S.round = []; S.hint = false;
    commit(); render();
  }
  function newLesson() {
    stopTyping();
    const keep = { sound: S.sound, room: S.room, rev: S.rev };
    S = Object.assign(defaults(), keep);
    commit(); render();
  }

  /* ---------- аватарки (SVG) ---------- */
  const COLORS = {
    "cobalt": "#2B4BF2", "cobalt-700": "#1C319D", "cobalt-100": "#D5DBFC",
    "sun": "#FFC629", "sun-100": "#FFF4D4", "paper": "#F3F4F7",
    "tomato": "#F0432E", "teal": "#14998F", "bubble": "#F5A9C6", "leaf": "#86B04A"
  };
  const SKIN = ["#F6D2B5", "#EBC09B", "#F3CCAA", "#D9A47E", "#F8DCC4", "#E2B48E"];
  const HAIR = ["#3B2A20", "#6B4423", "#C98A4B", "#14161F", "#8A5A31", "#2A1E18"];
  const SHIRT = ["#2B4BF2", "#14998F", "#FFC629", "#F0432E", "#1C319D", "#86B04A"];

  function face(cx, cy, r, skin, opts) {
    const o = opts || {};
    const ex = r * 0.38, ey = cy + r * 0.08;
    return `
      <circle cx="${cx - r * 0.98}" cy="${cy + 4}" r="${r * 0.18}" fill="${skin}"/>
      <circle cx="${cx + r * 0.98}" cy="${cy + 4}" r="${r * 0.18}" fill="${skin}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * (o.long ? 1.08 : 1)}" fill="${skin}"/>
      <circle cx="${cx - ex}" cy="${ey}" r="${r * 0.11}" fill="#14161F"/>
      <circle cx="${cx + ex}" cy="${ey}" r="${r * 0.11}" fill="#14161F"/>
      <circle cx="${cx - ex + 2}" cy="${ey - 2}" r="${r * 0.035}" fill="#fff"/>
      <circle cx="${cx + ex + 2}" cy="${ey - 2}" r="${r * 0.035}" fill="#fff"/>
      <circle cx="${cx - r * 0.6}" cy="${cy + r * 0.38}" r="${r * 0.14}" fill="#F5A9C6" opacity=".7"/>
      <circle cx="${cx + r * 0.6}" cy="${cy + r * 0.38}" r="${r * 0.14}" fill="#F5A9C6" opacity=".7"/>
      <path d="M${cx - r * 0.28} ${cy + r * 0.4} Q${cx} ${cy + r * 0.66} ${cx + r * 0.28} ${cy + r * 0.4}" stroke="#14161F" stroke-width="${r * 0.08}" fill="none" stroke-linecap="round"/>`;
  }

  function avatarSVG(c) {
    const bg = COLORS[c.color] || COLORS["cobalt-100"];
    const i = c.id;
    const skin = SKIN[i % SKIN.length], hair = HAIR[(i * 5) % HAIR.length];
    let shirt = SHIRT[i % SHIRT.length];
    if (shirt.toLowerCase() === bg.toLowerCase()) shirt = SHIRT[(i + 1) % SHIRT.length];
    const uid = "av" + i;
    let inner = "";

    if (c.avatar === "group") {
      const fig = (x, y, s, fill) => `
        <ellipse cx="${x}" cy="${y + 78 * s}" rx="${46 * s}" ry="${40 * s}" fill="${fill}"/>
        <circle cx="${x}" cy="${y}" r="${34 * s}" fill="${fill}"/>
        <circle cx="${x - 11 * s}" cy="${y + 2}" r="${4.5 * s}" fill="#fff"/>
        <circle cx="${x + 11 * s}" cy="${y + 2}" r="${4.5 * s}" fill="#fff"/>`;
      inner = fig(56, 86, 0.95, "#1C319D") + fig(146, 82, 0.95, "#14998F") + fig(100, 108, 1.15, "#14161F");
    } else {
      const small = c.avatar === "littlegirl";
      const cx = 100, cy = small ? 100 : 92, r = small ? 46 : 52;
      let back = "", front = "", extra = "";
      if (c.avatar === "boy") {
        front = `<path d="M${cx - 54} ${cy - 2} Q${cx - 56} ${cy - 62} ${cx} ${cy - 62} Q${cx + 56} ${cy - 62} ${cx + 54} ${cy - 2} Q${cx + 44} ${cy - 30} ${cx + 20} ${cy - 34} Q${cx} ${cy - 22} ${cx - 26} ${cy - 32} Q${cx - 46} ${cy - 26} ${cx - 54} ${cy - 2}Z" fill="${hair}"/>`;
      } else if (c.avatar === "girl") {
        back = `<path d="M${cx - 62} ${cy + 6} Q${cx - 66} ${cy - 66} ${cx} ${cy - 66} Q${cx + 66} ${cy - 66} ${cx + 62} ${cy + 6} L${cx + 66} ${cy + 78} Q${cx} ${cy + 96} ${cx - 66} ${cy + 78}Z" fill="${hair}"/>`;
        front = `<path d="M${cx - 54} ${cy + 2} Q${cx - 54} ${cy - 58} ${cx} ${cy - 58} Q${cx + 54} ${cy - 58} ${cx + 54} ${cy + 2} Q${cx + 36} ${cy - 30} ${cx} ${cy - 30} Q${cx - 34} ${cy - 30} ${cx - 54} ${cy + 2}Z" fill="${hair}"/>`;
        extra = `<circle cx="${cx + 38}" cy="${cy - 40}" r="10" fill="#FFC629" stroke="#14161F" stroke-width="3"/>`;
      } else if (c.avatar === "littlegirl") {
        back = `<circle cx="${cx - 56}" cy="${cy - 18}" r="22" fill="${hair}"/><circle cx="${cx + 56}" cy="${cy - 18}" r="22" fill="${hair}"/>`;
        front = `<path d="M${cx - 48} ${cy - 2} Q${cx - 48} ${cy - 52} ${cx} ${cy - 52} Q${cx + 48} ${cy - 52} ${cx + 48} ${cy - 2} Q${cx + 30} ${cy - 24} ${cx} ${cy - 26} Q${cx - 30} ${cy - 24} ${cx - 48} ${cy - 2}Z" fill="${hair}"/>`;
        extra = `<path d="M${cx - 66} ${cy - 40} l14 10 l-14 10z M${cx - 38} ${cy - 40} l-14 10 l14 10z" fill="#F0432E"/>
                 <path d="M${cx + 38} ${cy - 40} l14 10 l-14 10z M${cx + 66} ${cy - 40} l-14 10 l14 10z" fill="#F0432E"/>`;
      } else if (c.avatar === "teen") {
        front = `<path d="M${cx - 52} ${cy - 4} Q${cx - 58} ${cy - 66} ${cx - 6} ${cy - 76} Q${cx + 58} ${cy - 82} ${cx + 54} ${cy - 14} L${cx + 52} ${cy - 4} Q${cx + 46} ${cy - 34} ${cx + 22} ${cy - 40} Q${cx + 30} ${cy - 54} ${cx + 6} ${cy - 50} Q${cx - 20} ${cy - 40} ${cx - 38} ${cy - 38} Q${cx - 50} ${cy - 26} ${cx - 52} ${cy - 4}Z" fill="${hair}"/>`;
        extra = `<path d="M${cx - 14} 168 v24 M${cx + 14} 168 v24" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
      }
      inner = `
        ${back}
        <ellipse cx="${cx}" cy="${small ? 210 : 205}" rx="${small ? 62 : 72}" ry="58" fill="${shirt}"/>
        <rect x="${cx - 14}" y="${cy + r - 8}" width="28" height="22" rx="8" fill="${skin}"/>
        ${face(cx, cy, r, skin, { long: c.avatar === "teen" })}
        ${front}
        ${extra}`;
    }
    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${c.name}">
      <defs><clipPath id="${uid}"><circle cx="100" cy="100" r="100"/></clipPath></defs>
      <circle cx="100" cy="100" r="100" fill="${bg}"/>
      <g clip-path="url(#${uid})">${inner}</g>
    </svg>`;
  }

  /* ---------- рендер ---------- */
  function showScene(name) {
    ["table", "case", "end"].forEach((n) => { $("scene-" + n).hidden = n !== name; });
  }

  function render() {
    if (S.screen === "case") { renderCase({ type: S.step >= 3 ? "reaskInstant" : "askInstant", restore: true }); return; }
    stopTyping();
    if (S.screen === "end") { renderEnd(); showScene("end"); return; }
    renderTable(); showScene("table");
  }

  function renderTable() {
    const wrap = $("folders");
    wrap.innerHTML = "";
    CASES.forEach((c) => {
      const closed = S.closed.includes(c.id);
      const el = document.createElement("div");
      el.className = "folder" + (closed ? " closed" : "");
      el.dataset.id = c.id;
      el.innerHTML = `
        <div class="folder-tab"></div>
        <div class="folder-sheet"></div>
        <div class="folder-body">
          <span class="folder-place">${window.SUD.placeIcon(c)}</span>
          <span class="folder-num">${c.id}</span>
          <span class="folder-seal">⚖</span>
          ${closed ? `<span class="mini-stamp${S.lastClosed === c.id && !REDUCED ? " fresh" : ""}">ВІДМОВУ<br>ПРИЙНЯТО</span>` : ""}
        </div>`;
      el.addEventListener("click", () => openCase(c.id, el));
      wrap.appendChild(el);
    });
    $("counter").textContent = `Справ закрито: ${S.closed.length} з ${CASES.length}`;
  }

  function renderEnd() {
    const res = Object.entries(S.results).filter(([id]) => S.closed.includes(Number(id))).map(([, r]) => r);
    const count = (k) => res.filter((r) => r.badges.includes(k)).length;
    $("end-sub").textContent = `Справ розглянуто: ${S.closed.length} з ${CASES.length}`;
    $("end-no").textContent = plural(count("no"));
    $("end-noexcuse").textContent = plural(count("noexcuse"));
    $("end-held").textContent = plural(res.filter((r) => r.held).length);
  }
  function plural(n) {
    const m10 = n % 10, m100 = n % 100;
    const w = m10 === 1 && m100 !== 11 ? "справа" : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? "справи" : "справ";
    return `${n} ${w}`;
  }

  /* opts: { open, origin, type: ask|reask|askInstant|reaskInstant|null, verdict, restore } */
  function renderCase(opts) {
    const c = byId(S.caseId);
    if (!c) return;
    const card = $("case-card");
    showScene("case");

    $("case-tab").textContent = `Справа № ${c.id}`;
    $("case-place").textContent = typo(c.place);
    $("case-context").textContent = typo(c.context);
    $("speaker-name").textContent = c.name;
    $("speaker-role").textContent = c.role;
    const av = $("avatar");
    if (av.dataset.id !== String(c.id)) { av.innerHTML = avatarSVG(c); av.dataset.id = c.id; }
    av.classList.toggle("lean", S.step === 3 || (S.step === 4 && S.results[c.id] && S.results[c.id].held));

    if (opts.open) {
      const pos = folderOrigin(c.id);
      card.style.setProperty("--ox", pos.x + "px");
      card.style.setProperty("--oy", pos.y + "px");
      card.classList.remove("opening");
      void card.offsetWidth;
      if (!REDUCED) card.classList.add("opening");
    }

    // бульбашка
    const line = S.step >= 3 && !(S.step === 4 && !(S.results[c.id] || {}).held) ? c.reask : c.ask;
    if (opts.type === "ask") typeLine(c.ask, opts.open ? 380 : 0);
    else if (opts.type === "reask") typeLine(c.reask, 0);
    else if (opts.type === "askInstant") setLine(c.ask);
    else if (opts.type === "reaskInstant") setLine(c.reask);
    else if (opts.verdict || opts.restore) setLine(line);

    renderBadges(null);

    // вердикт
    const stamp = $("stamp"), gavel = $("gavel"), conf = $("confetti");
    stamp.className = "stamp"; gavel.className = "gavel"; conf.innerHTML = "";
    const ex = $("explain"), hp = $("hint-pill");
    if (S.step === 4) {
      if (opts.verdict && !REDUCED) {
        stopTyping(); setLine(line);
        void stamp.offsetWidth;
        gavel.classList.add("hit");
        playSound("knock");
        setTimeout(() => { stamp.classList.add("drop"); playSound("stamp"); burstLeaves(); }, 320);
      } else {
        gavel.classList.add("rest");
        stamp.classList.add("show");
        if (opts.verdict) playSound("stamp");
      }
      if (c.noExplain) {
        ex.innerHTML = `<b>📜 Стаття 2: тут пояснювати не треба взагалі.</b> ${escapeHtml(typo(c.explainNote || ""))}`;
        ex.hidden = false; hp.hidden = true;
      } else { ex.hidden = true; hp.hidden = false; }
    } else {
      ex.hidden = true; hp.hidden = false;
    }
  }

  function folderOrigin(id) {
    // позиція папки у координатах сцени (сітка 5×2 всередині столу)
    const idx = CASES.findIndex((c) => c.id === id);
    const col = idx % 5, row = Math.floor(idx / 5);
    const deskLeft = 110, deskTop = 330, deskW = 1700, deskH = 606;
    const gridW = 5 * 270 + 4 * 40, gridH = 2 * 236 + 44;
    const x = deskLeft + (deskW - gridW) / 2 + col * 310 + 135;
    const y = deskTop + (deskH - gridH) / 2 + row * 280 + 118;
    // card починається з (56, 44)
    return { x: x - 56, y: y - 44 };
  }

  function renderBadges(freshKey) {
    const box = $("badges");
    box.innerHTML = "";
    if (S.screen !== "case" || S.step === 4) return;
    if (S.hint && !S.round.length) {
      const h = document.createElement("span");
      h.className = "softhint";
      h.textContent = "Почніть з «ні» — цього вже досить";
      box.appendChild(h);
      return;
    }
    ["no", "noexcuse", "instead"].forEach((k) => {
      if (!S.round.includes(k)) return;
      const b = document.createElement("span");
      b.className = "badge" + (k === freshKey && !REDUCED ? " fly" : "");
      b.textContent = BADGES[k].screen;
      box.appendChild(b);
    });
  }

  function burstLeaves() {
    const conf = $("confetti");
    conf.innerHTML = "";
    const colors = ["#86B04A", "#14998F", "#FFC629", "#86B04A", "#2B4BF2", "#F5A9C6"];
    const n = 18;
    for (let k = 0; k < n; k++) {
      const a = (Math.PI * 2 * k) / n + Math.random() * 0.3;
      const d = 260 + Math.random() * 260;
      const l = document.createElement("span");
      l.className = "leaf";
      l.style.background = colors[k % colors.length];
      l.style.setProperty("--dx", Math.cos(a) * d * 1.4 + "px");
      l.style.setProperty("--dy", Math.sin(a) * d * 0.8 + 60 + "px");
      l.style.setProperty("--rot", (Math.random() * 540 - 270) + "deg");
      l.style.animationDelay = Math.random() * 60 + "ms";
      conf.appendChild(l);
    }
    setTimeout(() => { conf.innerHTML = ""; }, 900);
  }

  /* ---------- друк репліки ---------- */
  let typingTimer = null;
  function stopTyping() {
    clearTimeout(typingTimer); typingTimer = null;
    $("avatar").classList.remove("speaking");
  }
  function setLine(text) {
    stopTyping();
    $("bubble-text").textContent = typo(text);
  }
  function typeLine(text, delay) {
    stopTyping();
    const el = $("bubble-text");
    if (REDUCED) { el.textContent = text; return; }
    text = typo(text);
    const chars = Array.from(text);
    let i = 0;
    el.textContent = "";
    const av = $("avatar");
    const tick = () => {
      i++;
      el.innerHTML = escapeHtml(chars.slice(0, i).join("")) + (i < chars.length ? '<span class="caret"></span>' : "");
      if (i < chars.length) typingTimer = setTimeout(tick, 25);
      else { typingTimer = setTimeout(() => av.classList.remove("speaking"), 500); }
    };
    // «Невидимий» повний текст для збереження висоти не потрібен: бульбашка має мін. висоту
    typingTimer = setTimeout(() => { av.classList.add("speaking"); tick(); }, delay || 0);
  }
  function typo(s) { return String(s).replace(/'/g, "\u2019"); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }

  /* ---------- звуки (Web Audio, без файлів) ---------- */
  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
    } catch (_) {}
  }
  function noiseBuffer(sec) {
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * sec), actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function playSound(kind) {
    if (!S.sound) return;
    unlockAudio();
    if (!actx) return;
    const t = actx.currentTime + 0.01;
    const out = actx.createGain(); out.connect(actx.destination);
    if (kind === "rustle") {
      const src = actx.createBufferSource(); src.buffer = noiseBuffer(0.45);
      const bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.8;
      src.connect(bp); bp.connect(out);
      out.gain.setValueAtTime(0.0001, t);
      out.gain.linearRampToValueAtTime(0.18, t + 0.06);
      out.gain.linearRampToValueAtTime(0.08, t + 0.18);
      out.gain.linearRampToValueAtTime(0.14, t + 0.26);
      out.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);
      src.start(t); src.stop(t + 0.45);
    } else if (kind === "stamp" || kind === "knock") {
      const o = actx.createOscillator(); o.type = "sine";
      const base = kind === "stamp" ? 110 : 240;
      o.frequency.setValueAtTime(base * 1.8, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 0.08);
      const g = actx.createGain(); o.connect(g); g.connect(out);
      g.gain.setValueAtTime(kind === "stamp" ? 0.7 : 0.35, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "stamp" ? 0.3 : 0.15));
      o.start(t); o.stop(t + 0.32);
      const n = actx.createBufferSource(); n.buffer = noiseBuffer(0.08);
      const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = kind === "stamp" ? 900 : 2200;
      const ng = actx.createGain(); n.connect(lp); lp.connect(ng); ng.connect(out);
      ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      n.start(t); n.stop(t + 0.08);
      out.gain.value = 1;
    } else if (kind === "pop") {
      const o = actx.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.12);
      const g = actx.createGain(); o.connect(g); g.connect(out);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t); o.stop(t + 0.22);
      out.gain.value = 1;
    }
  }

  /* ---------- масштаб 16:9 ---------- */
  function fit() {
    const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    const st = $("stage");
    st.style.transformOrigin = "center center";
    st.style.transform = `translate(-50%, -50%) scale(${k})`;
  }
  window.addEventListener("resize", fit);

  /* ---------- клавіатура-дублер ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    unlockAudio();
    const code = e.code;
    const map = {
      Space: () => next(),
      Escape: () => toTable(),
      Digit1: () => giveBadge("no"), Numpad1: () => giveBadge("no"),
      Digit2: () => giveBadge("noexcuse"), Numpad2: () => giveBadge("noexcuse"),
      Digit3: () => giveBadge("instead"), Numpad3: () => giveBadge("instead"),
      KeyP: () => gotoStep(3),
      KeyS: () => retry(),
      KeyV: () => verdict(),
      KeyF: () => toggleFullscreen()
    };
    if (map[code]) { e.preventDefault(); map[code](); }
  });
  document.addEventListener("pointerdown", unlockAudio);

  function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement) { (d.documentElement.requestFullscreen || function () {}).call(d.documentElement); }
    else if (d.exitFullscreen) d.exitFullscreen();
  }

  $("pult-link").addEventListener("click", (e) => {
    e.preventDefault();
    const w = window.open($("pult-link").href, "sud-pult", "width=480,height=900");
    if (!w) window.location.href = $("pult-link").href;
  });

  window.addEventListener("storage", (e) => {
    // інша вкладка з екраном змінила стан — підхоплюємо
    if (e.key === LS_KEY) { S = load(); render(); }
  });

  /* ---------- старт ---------- */
  fit();
  render();
  S.lastClosed = null;
  broadcast();
  updateDot();
})();
