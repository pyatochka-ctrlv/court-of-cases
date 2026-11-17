/* ===== Папки суду · пульт тренера (майстер по кроках) =====
   Пульт нічого не вирішує сам: надсилає команди екрану гри і показує стан,
   який екран транслює у відповідь. Логіка екрана не змінювалась. */
(function () {
  "use strict";
  const { CASES } = window.SUD;
  const Sync = window.SudSync;
  const $ = (id) => document.getElementById(id);
  const byId = (id) => CASES.find((c) => c.id === id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  let state = null;   // останній знімок від екрана
  let lastBC = 0, lastFB = 0;
  let room = null, fbSub = null;

  /* Локальний підкрок пульта: «Крок 4 · Вердикт» — це той самий стан екрана, що й крок 3
     (персонаж уже перепитав), тож пам'ятаємо його тут. */
  let verdictFor = null;
  try { verdictFor = Number(sessionStorage.getItem("sud-pult-verdict")) || null; } catch (_) {}
  function setVerdictFor(v) {
    verdictFor = v;
    try { v ? sessionStorage.setItem("sud-pult-verdict", String(v)) : sessionStorage.removeItem("sud-pult-verdict"); } catch (_) {}
  }
  /* Після «👍 Було чітке «ні»» даємо бейджу секунду на екрані, потім персонаж перепитує. */
  let pending = null; // { caseId, timer }
  let tipsOpen = false;

  /* ---------- зв'язок ---------- */
  const channel = Sync.openChannel((msg) => {
    if (!msg || msg.from !== "screen" || msg.type !== "state") return;
    lastBC = Date.now();
    accept(msg.state);
  });

  function accept(st) {
    if (!st) return;
    if (state && st.t < state.t) return;
    state = st;
    // крок «Вердикт» живий, поки ця справа на кроці 3 (або щойно отримала печатку)
    if (verdictFor && (st.screen !== "case" || st.caseId !== verdictFor || st.step < 3)) setVerdictFor(null);
    if (pending && (st.screen !== "case" || st.caseId !== pending.caseId || st.step >= 3)) {
      clearTimeout(pending.timer); pending = null;
    }
    render();
  }

  const bcAlive = () => Date.now() - lastBC < 6000;
  const fbAlive = () => Date.now() - lastFB < 12000;

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
  setInterval(() => { send("ping"); renderChrome(); }, 2500);
  window.addEventListener("beforeunload", () => channel.post({ from: "pult", type: "bye" }));

  /* ---------- де ми зараз ---------- */
  function phase() {
    if (!state) return "nostate";
    if (state.screen === "end") return "end";
    if (state.screen !== "case" || !byId(state.caseId)) return "table";
    if (pending && pending.caseId === state.caseId) return "w3";
    if (state.step === 1) return "w1";
    if (state.step === 2) return "w2";
    if (state.step === 3) return verdictFor === state.caseId ? "w4" : "w3";
    return "done";
  }

  /* ---------- дії ---------- */
  const ACTIONS = {
    openScreen() { const w = window.open("index.html", "sud-screen"); if (w) setTimeout(() => send("hello"), 800); },
    open(id) { cmd("open", Number(id)); },
    random() { cmd("random"); },
    end() { cmd("end"); },
    table() { cmd("table"); },
    newLesson() { openModal(); },
    answered1() { cmd("step", 2); },                     // екран: без змін
    goodNo() {                                           // бейдж → через мить перепитування
      cmd("badge", "no");
      const id = state.caseId;
      pending = { caseId: id, timer: setTimeout(() => { pending = null; cmd("reask"); render(); }, 1400) };
      render();
    },
    notYet() { cmd("retry"); },                          // екран: м'яка підказка, прохання ще раз
    chip(k) { cmd("badge", k); },
    answered3() {                                        // екран: без змін
      if (pending) { clearTimeout(pending.timer); pending = null; cmd("reask"); }
      setVerdictFor(state.caseId); render();
    },
    stamp() { cmd("verdict"); },
    again() { setVerdictFor(null); cmd("retry"); },      // екран: персонаж перепитує знову
    back() {
      const p = phase();
      if (p === "w1") cmd("table");
      else if (p === "w2") cmd("step", 1);
      else if (p === "w3") {
        if (pending) { clearTimeout(pending.timer); pending = null; render(); }
        else cmd("rewind");
      }
      else if (p === "w4") { setVerdictFor(null); render(); }
      else if (p === "done") {
        const r = state.results && state.results[state.caseId];
        if (r && r.held) setVerdictFor(state.caseId);
        cmd("rewind");
      }
    }
  };

  /* ---------- рендер ---------- */
  let lastKey = "";
  function render() {
    renderChrome();
    const p = phase();
    const key = JSON.stringify([p, state && state.caseId, state && state.round, state && state.closed, !!pending, tipsOpen]);
    if (key === lastKey) return;
    const phaseChanged = !lastKey || JSON.parse(lastKey)[0] !== p || JSON.parse(lastKey)[1] !== (state && state.caseId);
    lastKey = key;
    const view = $("view");
    view.innerHTML = VIEWS[p] ? VIEWS[p]() : "";
    if (phaseChanged) { view.classList.remove("fade"); void view.offsetWidth; view.classList.add("fade"); }
    const tips = view.querySelector("details.tips");
    if (tips) tips.addEventListener("toggle", () => { tipsOpen = tips.open; lastKey = JSON.stringify([p, state && state.caseId, state && state.round, state && state.closed, !!pending, tipsOpen]); });
  }

  function renderChrome() {
    const on = bcAlive() || (room && fbAlive());
    const label = on ? "Екран гри підключено" : "Екран гри не підключено";
    $("dot").classList.toggle("on", !!on);
    $("dot").title = label; $("dot").setAttribute("aria-label", label);
    $("menu-status").textContent = label + (on && !bcAlive() && room ? " · кімната " + room : "");
    $("offline").hidden = !!on;
    if (room && fbAlive()) $("room-note").textContent = "Кімната " + room + " ✓";
    const snd = !!(state && state.sound);
    $("btn-sound").setAttribute("aria-pressed", snd ? "true" : "false");
    $("btn-sound").textContent = snd ? "🔊 Звук: увімкнено" : "🔇 Звук: вимкнено";
  }

  function button(kind, action, label, caption, arg) {
    return `<div class="btn-wrap">
      <button type="button" class="btn btn--${kind}" data-act="${action}"${arg != null ? ` data-arg="${esc(arg)}"` : ""}>${label}</button>
      ${caption ? `<div class="cap">${caption}</div>` : ""}
    </div>`;
  }

  function stepHead(n, c, doneLabel) {
    const dots = [1, 2, 3, 4].map((i) => `<i class="${i < n || doneLabel ? "on" : i === n ? "cur" : ""}"></i>`).join("");
    return `<div class="step-top">
        <div class="progress"><span class="dots" aria-hidden="true">${dots}</span><span>${doneLabel || `Крок ${n} з 4`}</span></div>
        <button type="button" class="back" data-act="back" title="Повернути один крок назад — і на екрані дітей теж">↩ Назад</button>
      </div>
      <div class="case-name">Справа № ${c.id} · ${esc(c.title)}</div>`;
  }

  function tips(c) {
    return `<details class="tips"${tipsOpen ? " open" : ""}>
      <summary>💡 Підказка для тренера</summary>
      <div class="tips-body">
        <h3>Сильні відповіді</h3>
        <ul>${c.strong.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        <h3>На що звернути увагу</h3>
        <p>${esc(c.note)}</p>
        ${c.noExplain
          ? `<div class="art2"><b>📜 Стаття 2: тут пояснення не потрібні взагалі.</b> ${esc(c.explainNote || "")}</div>`
          : `<div class="art2">💬 Пояснення — за бажанням. Коротке «бо» можна, але «ні» вже достатньо.</div>`}
      </div>
    </details>`;
  }

  const cur = () => byId(state.caseId);
  const who = (c) => `${esc(c.name)}, ${esc(c.role)}`;

  const VIEWS = {
    nostate() {
      return `<h1>Відкрийте екран гри</h1>
        <p class="lead">Пульт керує екраном, який ви демонструєте дітям. Спершу відкрийте його в сусідній вкладці.</p>
        <div class="btns">${button("primary", "openScreen", "🔗 Відкрити екран гри", "Відкриється вкладка зі столом і папками — її й демонструйте")}</div>`;
    },

    table() {
      const closed = state.closed || [];
      const left = CASES.length - closed.length;
      const folders = CASES.map((c) => {
        const isClosed = closed.includes(c.id);
        return `<button type="button" class="f${isClosed ? " closed" : ""}" data-act="open" data-arg="${c.id}" aria-label="Справа ${c.id}: ${esc(c.title)}${isClosed ? ", закрита" : ""}">
          <span class="f-num">${c.id}</span><span class="f-title">${esc(c.title)}</span></button>`;
      }).join("");
      return `<h1>Оберіть справу</h1>
        <p class="lead">Спитайте дітей: «Хто хоче відкрити папку? Назвіть номер!»</p>
        <div class="folders">${folders}</div>
        <div class="btns">${left
          ? button("primary", "random", "🎲 Випадкова справа", "На екрані відкриється випадкова невідкрита папка")
          : button("primary", "end", "🏁 Завершити засідання", "Усі справи закрито! На екрані: підсумок засідання")}</div>
        ${left ? `<a href="#" class="end-link" data-act="end">Завершити засідання</a>` : ""}`;
    },

    w1() {
      const c = cur();
      return `${stepHead(1, c)}
        <p class="now"><b>Що зараз робимо:</b> прочитайте прохання голосом персонажа. Потім попросіть охочого відмовити.</p>
        <div class="read"><p>${esc(c.ask)}</p><div class="who">— ${who(c)}</div></div>
        <div class="btns">${button("primary", "answered1", "Дитина відповіла →", "На екрані нічого не зміниться")}</div>
        ${tips(c)}`;
    },

    w2() {
      const c = cur();
      const round = state.round || [];
      const chip = (k, label) => `<button type="button" class="chip${round.includes(k) ? " on" : ""}" data-act="chip" data-arg="${k}" aria-pressed="${round.includes(k)}">${label}</button>`;
      return `${stepHead(2, c)}
        <p class="now"><b>Як прозвучало «ні»?</b> Оцініть відповідь. Діти бачать лише похвалу — оцінки вони не бачать.</p>
        <div class="btns">
          ${button("primary", "goodNo", "👍 Було чітке «ні»", "На екрані: бейдж «Чітке «ні»!», а потім персонаж перепитує")}
          ${button("secondary", "notYet", "🔄 Ще не вийшло", "На екрані: м'яка підказка «Почніть з «ні» — цього вже досить», персонаж повторює прохання")}
        </div>
        <div class="extra">
          <div class="extra-label">Додати похвалу (за бажанням) — з'явиться бейджем на екрані:</div>
          <div class="chips">${chip("noexcuse", "💬 Без виправдань")}${chip("instead", "⭐ Запропонували інше")}</div>
        </div>
        ${tips(c)}`;
    },

    w3() {
      const c = cur();
      return `${stepHead(3, c)}
        <p class="now"><b>Що зараз робимо:</b> прочитайте, як персонаж перепитує. Дитина має повторити своє «ні».</p>
        <div class="read"><p>${esc(c.reask)}</p><div class="who">— ${who(c)}</div></div>
        <div class="btns">${button("primary", "answered3", "Дитина відповіла →",
          pending ? "Перепитування з'являється на екрані…" : "На екрані нічого не зміниться")}</div>
        ${tips(c)}`;
    },

    w4() {
      const c = cur();
      return `${stepHead(4, c)}
        <p class="now"><b>Вердикт:</b> дитина втримала своє «ні»?</p>
        <div class="btns">
          ${button("primary", "stamp", "✅ Так — ставимо печатку!", "На екрані: печатка «Відмову прийнято» і конфеті" + (c.noExplain ? ", а внизу — жовта плашка «Стаття 2»" : ""))}
          ${button("secondary", "again", "🔄 Ще раз", "На екрані: персонаж перепитує знову, з м'якою підказкою «Почніть з «ні»»")}
        </div>
        ${tips(c)}`;
    },

    done() {
      const c = cur();
      const closed = state.closed || [];
      const left = CASES.length - closed.length;
      return `${stepHead(4, c, "Готово ✓")}
        <p class="now"><b>Що зараз робимо:</b> похваліть дитину.${c.noExplain ? " На екрані жовта плашка «Стаття 2» — прочитайте її вголос:" : ""}</p>
        ${c.noExplain ? `<div class="read read--art"><p>📜 Стаття 2: тут пояснювати не треба взагалі. ${esc(c.explainNote || "")}</p></div>` : ""}
        <div class="btns">
          ${left
            ? button("primary", "random", "🎲 Наступна справа", `На екрані відкриється випадкова невідкрита папка (лишилось ${left})`)
            : button("primary", "end", "🏁 Завершити засідання", "Усі 10 справ закрито! На екрані: підсумок засідання")}
          ${button("secondary", "table", "← До столу", "На екрані: стіл з папками — діти обирають номер самі")}
        </div>
        ${tips(c)}`;
    },

    end() {
      return `<h1>Засідання закрито 🎉</h1>
        <p class="lead">На екрані — підсумок: скільки справ розглянули. Похваліть усіх суддів!</p>
        <div class="btns">
          ${button("primary", "table", "← Повернутися до столу", "На екрані знову з'явиться стіл із папками")}
          ${button("secondary", "newLesson", "🧹 Новий урок", "Усі папки знову стануть запечатаними (спершу спитаємо)")}
        </div>`;
    }
  };

  /* ---------- події ---------- */
  $("view").addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    e.preventDefault();
    const fn = ACTIONS[el.dataset.act];
    if (fn) fn(el.dataset.arg);
  });

  const menu = $("menu"), menuBtn = $("btn-menu");
  function setMenu(open) { menu.hidden = !open; menuBtn.setAttribute("aria-expanded", open ? "true" : "false"); }
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) setMenu(false); });
  $("btn-open-screen").addEventListener("click", () => { setMenu(false); ACTIONS.openScreen(); });
  $("btn-open-screen-2").addEventListener("click", () => ACTIONS.openScreen());
  $("btn-sound").addEventListener("click", () => cmd("sound", !(state && state.sound)));
  $("btn-new").addEventListener("click", () => { setMenu(false); openModal(); });

  const modal = $("modal");
  function openModal() { modal.hidden = false; $("modal-cancel").focus(); }
  $("modal-cancel").addEventListener("click", () => { modal.hidden = true; });
  $("modal-ok").addEventListener("click", () => { modal.hidden = true; setVerdictFor(null); cmd("newLesson"); });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modal.hidden) modal.hidden = true;
    else if (!menu.hidden) setMenu(false);
  });

  render();
})();
