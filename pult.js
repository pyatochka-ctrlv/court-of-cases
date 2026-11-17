/* ===== Папки суду · пульт тренера =====
   Пульт нічого не вирішує сам: надсилає команди і показує стан, який транслює екран гри. */
(function () {
  "use strict";
  const { CASES } = window.SUD;
  const Sync = window.SudSync;
  const $ = (id) => document.getElementById(id);
  const byId = (id) => CASES.find((c) => c.id === id);

  let state = null;      // останній знімок від екрана
  let lastBC = 0;        // коли востаннє чули екран через BroadcastChannel
  let lastFB = 0;        // ... через кімнату Firebase
  let room = null;
  let fbSub = null;

  /* ---------- зв'язок ---------- */
  const channel = Sync.openChannel((msg) => {
    if (!msg || msg.from !== "screen" || msg.type !== "state") return;
    lastBC = Date.now();
    accept(msg.state);
  });

  function accept(st) {
    if (!st) return;
    if (state && st.t < state.t) return; // старіший знімок (напр. затримка мережі)
    state = st;
    if (st.room && !room && Sync.fbEnabled()) { $("room-code").value = st.room; }
    render();
  }

  function bcAlive() { return Date.now() - lastBC < 6000; }
  function fbAlive() { return Date.now() - lastFB < 12000; }

  function send(type, cmd, arg) {
    const msg = { from: "pult", type, id: Sync.makeId(), cmd, arg };
    channel.post(msg);
    if (room && !bcAlive()) Sync.fbPut("rooms/" + room + "/cmd", msg);
  }
  const cmd = (name, arg) => send("cmd", name, arg);

  function joinRoom(code) {
    code = String(code || "").replace(/\D/g, "").slice(0, 4);
    if (code.length !== 4) { $("room-note").textContent = "Потрібно 4 цифри."; return; }
    room = code;
    try { localStorage.setItem("sud-pult-room", code); } catch (_) {}
    if (fbSub) fbSub.close();
    fbSub = Sync.fbListen("rooms/" + code + "/state", (st) => { if (st) { lastFB = Date.now(); accept(st); } });
    send("hello");
    $("room-note").textContent = "Кімната " + code + ": чекаємо на екран гри…";
  }

  if (Sync.fbEnabled()) {
    $("room").hidden = false;
    const fromUrl = new URLSearchParams(location.search).get("room");
    let saved = null;
    try { saved = localStorage.getItem("sud-pult-room"); } catch (_) {}
    const code = fromUrl || saved;
    if (code) { $("room-code").value = code; joinRoom(code); }
    $("btn-room").addEventListener("click", () => joinRoom($("room-code").value));
    $("room-code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom($("room-code").value); });
  }

  send("hello");
  setInterval(() => { send("ping"); updateStatus(); }, 2500);
  window.addEventListener("beforeunload", () => channel.post({ from: "pult", type: "bye" }));

  function updateStatus() {
    const on = bcAlive() || (room && fbAlive());
    $("dot").classList.toggle("on", !!on);
    $("status-text").textContent = on
      ? (bcAlive() ? "Екран гри підключено" : "Екран гри підключено · кімната " + room)
      : "Екран гри не підключено";
    if (room && fbAlive()) $("room-note").textContent = "Кімната " + room + " ✓";
    document.body.classList.toggle("offline", !on);
  }

  /* ---------- рендер ---------- */
  function renderFolders() {
    const wrap = $("folders");
    wrap.innerHTML = "";
    const closed = state ? state.closed : [];
    const curId = state && state.screen === "case" ? state.caseId : null;
    CASES.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "f" + (closed.includes(c.id) ? " closed" : "") + (c.id === curId ? " current" : "");
      b.innerHTML = `<span class="f-num">${c.id}</span><span class="f-title">${esc(c.title)}</span><span class="f-meta">${esc(c.place)}${closed.includes(c.id) ? " · закрита" : ""}</span>`;
      b.setAttribute("aria-label", `Справа ${c.id}: ${c.title}${closed.includes(c.id) ? ", закрита" : ""}`);
      b.addEventListener("click", () => cmd("open", c.id));
      wrap.appendChild(b);
    });
    $("count").textContent = `${closed.length} з ${CASES.length}`;
    $("btn-random").disabled = closed.length >= CASES.length;
  }

  function render() {
    updateStatus();
    renderFolders();
    const snd = state && state.sound;
    $("btn-sound").setAttribute("aria-pressed", snd ? "true" : "false");
    $("btn-sound").textContent = snd ? "🔊 Звук увімкнено" : "🔇 Звук вимкнено";
    $("btn-sound").title = snd ? "Якщо звуку не чути — клацніть один раз по екрану гри" : "";

    const open = state && state.screen === "case" && byId(state.caseId);
    $("current-empty").hidden = !!open;
    $("current-case").hidden = !open;
    if (!open) {
      $("empty-text").textContent = !state
        ? "Відкрийте екран гри — кнопка «🔗 Відкрити екран гри» вгорі."
        : state.screen === "end"
          ? "На екрані — підсумок засідання. Оберіть папку, щоб продовжити, або натисніть «Новий урок»."
          : "Оберіть папку — справа відкриється на екрані гри.";
      return;
    }
    const c = open, step = state.step;
    $("c-num").textContent = "№ " + c.id;
    $("c-title").textContent = c.title;
    $("c-meta").textContent = `${c.place} · ${c.name}, ${c.role}`;
    $("c-context").textContent = c.context;
    $("c-name").textContent = c.name;
    $("c-ask").textContent = c.ask;
    $("c-reask").textContent = c.reask;
    $("line-ask").classList.toggle("active", step <= 2);
    $("line-reask").classList.toggle("active", step === 3);

    document.querySelectorAll(".step").forEach((b) => {
      const n = Number(b.dataset.step);
      b.classList.toggle("active", n === step);
      b.classList.toggle("done", n < step);
    });

    const res = (state.results && state.results[c.id]) || { badges: [] };
    document.querySelectorAll("[data-badge]").forEach((b) => {
      const k = b.dataset.badge;
      b.classList.toggle("shown", state.round.includes(k));
      b.classList.toggle("given", !state.round.includes(k) && res.badges.includes(k));
      b.disabled = step === 4;
    });
    $("btn-retry").disabled = step === 4;
    $("btn-reask").disabled = step >= 3;
    $("btn-verdict").disabled = step === 4;
    $("btn-rewind").disabled = false;
    $("btn-retry").textContent = step >= 3 && step < 4 ? "🔁 Ще спроба (перепитування)" : "🔁 Ще спроба";

    $("c-strong").innerHTML = c.strong.map((s) => `<li>${esc(s)}</li>`).join("");
    $("c-note").textContent = c.note;
    const ex = $("c-explain");
    ex.classList.toggle("yes", !!c.noExplain);
    ex.innerHTML = c.noExplain
      ? `<b>📜 Пояснення тут не потрібні взагалі.</b> ${esc(c.explainNote || "")}<br><small>Після вердикту на екрані з'явиться плашка «Стаття 2».</small>`
      : `<b>💬 Пояснення — за бажанням.</b> Коротке «бо» можна, але «ні» вже достатньо.`;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])); }

  /* ---------- кнопки ---------- */
  $("btn-open-screen").addEventListener("click", () => {
    const w = window.open("index.html", "sud-screen");
    if (w) setTimeout(() => send("hello"), 800);
  });
  $("btn-sound").addEventListener("click", () => cmd("sound", !(state && state.sound)));
  $("btn-random").addEventListener("click", () => cmd("random"));
  $("btn-end").addEventListener("click", () => cmd("end"));
  $("btn-table").addEventListener("click", () => cmd("table"));
  $("btn-retry").addEventListener("click", () => cmd("retry"));
  $("btn-reask").addEventListener("click", () => cmd("reask"));
  $("btn-verdict").addEventListener("click", () => cmd("verdict"));
  $("btn-rewind").addEventListener("click", () => cmd("rewind"));
  document.querySelectorAll(".step").forEach((b) => b.addEventListener("click", () => cmd("step", Number(b.dataset.step))));
  document.querySelectorAll("[data-badge]").forEach((b) => b.addEventListener("click", () => cmd("badge", b.dataset.badge)));

  // «Новий урок» — власне модальне вікно
  const modal = $("modal");
  $("btn-new").addEventListener("click", () => { modal.hidden = false; $("modal-cancel").focus(); });
  $("modal-cancel").addEventListener("click", () => { modal.hidden = true; });
  $("modal-ok").addEventListener("click", () => { modal.hidden = true; cmd("newLesson"); });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) modal.hidden = true; });

  render();
})();
