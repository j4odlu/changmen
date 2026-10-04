/**
 * [changmen 扩展] RAY 官网 2026-10-03 app.3d3117bb.js：
 * /user 的 Authorization 来自 Vue store.gameAccount.authToken，已不写 gameAuthToken。
 * MAIN world 只在用户点击采集图标时读取当前会话；不修改页面请求或持久化凭证。
 */
(function installRaySessionReader() {
  if (globalThis.__CHANGMEN_RAY_SESSION_READER__) return;
  globalThis.__CHANGMEN_RAY_SESSION_READER__ = true;
  window.addEventListener("message", event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin
      || message?.source !== "changmen-ray-session-request"
      || typeof message.requestId !== "string") return;
    let session;
    const logo = document.querySelector(".app-header img[alt=RAYBET], .app-header .logo-icon");
    if (logo) {
      let store = document.querySelector("#app")?.__vue__?.$store;
      // Vue mount may replace #app; header component ancestors share the same store.
      for (let node = logo, depth = 0; !store && node && depth < 32; node = node.parentElement, depth++) {
        store = node.__vue__?.$store;
      }
      const token = store?.state?.gameAccount?.authToken;
      if (typeof token === "string" && token.trim()) {
        session = { token: token.trim(), gateway: String(store.getters?.gameAPI || "") };
      }
    }
    window.postMessage({
      source: "changmen-ray-session-response", requestId: message.requestId, session,
    }, location.origin);
  });
})();
