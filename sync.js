/* Спільний зв'язок екрана і пульта.
   1) BroadcastChannel('sud-papky') — дві вкладки одного браузера.
   2) Необов'язково: Firebase Realtime Database через REST (без SDK) — кімната з кодом на 4 цифри. */
(function () {
  const cfg = window.SUD_CONFIG || {};
  const FB = String(cfg.firebaseDatabaseURL || "").trim().replace(/\/+$/, "");

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function openChannel(onMessage) {
    if (!("BroadcastChannel" in window)) return { post() {}, close() {} };
    const ch = new BroadcastChannel("sud-papky");
    ch.onmessage = (e) => onMessage(e.data);
    return { post: (m) => { try { ch.postMessage(m); } catch (_) {} }, close: () => ch.close() };
  }

  function fbEnabled() { return !!FB; }

  function fbPut(path, data) {
    if (!FB) return Promise.resolve();
    return fetch(FB + "/" + path + ".json", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).catch(() => {});
  }

  /* Слухаємо гілку; onData отримує повне значення гілки (ми пишемо тільки цілими PUT). */
  function fbListen(path, onData) {
    if (!FB || !("EventSource" in window)) return { close() {} };
    let es;
    try { es = new EventSource(FB + "/" + path + ".json"); } catch (_) { return { close() {} }; }
    const handle = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg && msg.path === "/") onData(msg.data);
      } catch (_) {}
    };
    es.addEventListener("put", handle);
    es.addEventListener("patch", handle);
    return { close: () => es.close() };
  }

  function newRoomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  window.SudSync = { makeId, openChannel, fbEnabled, fbPut, fbListen, newRoomCode };
})();
