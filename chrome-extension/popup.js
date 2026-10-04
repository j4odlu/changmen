const ENABLED_KEY = "pbWsObserveEnabled";
const STATUS_KEY = "pbWsObserve";

document.getElementById("ver").textContent = chrome.runtime.getManifest().version;
const updateStatus = document.getElementById("updateStatus");
const latestVersion = document.getElementById("latestVersion");
const checkUpdate = document.getElementById("checkUpdate");
const downloadUpdate = document.getElementById("downloadUpdate");
let checkingUpdates = false;
function renderRelease(state = {}) {
  latestVersion.textContent = state.latest || "—";
  updateStatus.textContent = state.error || (state.updateAvailable ? `有新版本 ${state.latest}，可下载更新` : state.latest ? "当前插件已是最新版或更新版本" : "暂未获取到最新版本");
  updateStatus.className = state.error ? "status err" : state.updateAvailable ? "status ok" : "status";
  const safeUrl = typeof state.downloadUrl === "string" && /^https:\/\/changmen\.fun\/esport2\/extensions\/\d{1,5}(?:\.\d{1,5}){0,3}\.zip$/.test(state.downloadUrl);
  downloadUpdate.hidden = !safeUrl;
  if (safeUrl) {
    downloadUpdate.href = state.downloadUrl;
    downloadUpdate.textContent = `下载 ${state.latest}`;
  } else downloadUpdate.removeAttribute("href");
  checkUpdate.disabled = checkingUpdates;
}
function refreshRelease(force = false) {
  if (force && checkingUpdates) return;
  if (force) { checkingUpdates = true; checkUpdate.disabled = true; updateStatus.textContent = "正在检查插件版本…"; }
  chrome.runtime.sendMessage({ type: force ? "extensionRelease:check" : "extensionRelease:get" }, state => {
    const failed = chrome.runtime.lastError;
    if (force) checkingUpdates = false;
    renderRelease(failed ? { error: "插件更新服务暂不可用，请稍后重试" } : state);
  });
}
checkUpdate.addEventListener("click", () => refreshRelease(true));
refreshRelease(true);

const toggle = document.getElementById("pbWs");
const statusEl = document.getElementById("pbStatus");
const subsEl = document.getElementById("pbSubs");

function mark(ok) {
  return ok ? '<span class="ok">✓</span>' : '<span class="miss">✗</span>';
}

function isWsLive(s) {
  if (s.phase === "ws_closed" || s.phase === "off" || s.phase === "hook_stop") return false;
  if (Number(s.readyState) === 3) return false;
  if (s.connected === true || Number(s.readyState) === 1 || s.phase === "connected") return true;
  const t = String(s.lastType || "");
  return Number(s.frameCount) > 0 && /^(CONNECTED|PING|PONG|UPDATE_|FULL_)/.test(t);
}

function renderStatus(bag) {
  const enabled = bag?.[ENABLED_KEY] !== false;
  const s = bag?.[STATUS_KEY] || {};
  const pageDetected = bag?.pageDetected === true;
  const pageCount = Number(bag?.pageCount) || 0;
  toggle.checked = enabled;
  if (!enabled) {
    statusEl.className = "status";
    statusEl.textContent = "状态：已关闭";
    subsEl.innerHTML = "订阅：已关闭";
    return;
  }
  const live = isWsLive(s);
  const boardN = Array.isArray(s.latestOdds) ? s.latestOdds.length : 0;
  const wsClosed = Number(s.readyState) === 3 || s.phase === "ws_closed";
  const page = pageDetected
    ? `网页×${pageCount || 1}`
    : "未检测到网页";
  const head = live
    ? "已 CONNECTED"
    : wsClosed
      ? "WS 已断开"
      : pageDetected
        ? "网页在 · WS 连接中"
        : "等待平博页";
  const parts = [
    page,
    head,
    s.phase ? `phase=${s.phase}` : null,
    s.readyState != null ? `rs=${s.readyState}` : null,
    s.frameCount != null ? `帧=${s.frameCount}` : null,
    s.lastType ? `last=${s.lastType}` : null,
    boardN ? `盘=${boardN}` : null,
    s.lastError ? `err=${s.lastError}` : null,
  ].filter(Boolean);
  statusEl.className = s.lastError || wsClosed ? "status err" : live ? "status ok" : "status";
  statusEl.textContent = `状态：${parts.join(" · ")}`;

  const out = Array.isArray(s.subscribedOut) ? s.subscribedOut : [];
  const checklist = s.checklist || {};
  const required = Array.isArray(checklist.required) ? checklist.required : [];
  const reqLines = required.length
    ? required.map((r) => `${mark(r.ok)}${r.destination}`).join(" ")
    : "—";
  subsEl.innerHTML = `必查 ${reqLines}<br>SUBSCRIBE：${out.length ? out.join(", ") : "—"}`;
}

function refresh() {
  chrome.runtime.sendMessage({ type: "pbWsObserveGet" }, (res) => {
    if (chrome.runtime.lastError) {
      chrome.storage.local.get([ENABLED_KEY, STATUS_KEY], renderStatus);
      return;
    }
    const payload = res?.response && typeof res.response === "object" ? res.response : res;
    renderStatus({
      [ENABLED_KEY]: payload?.enabled !== false,
      [STATUS_KEY]: payload?.observe || {},
      pageDetected: payload?.pageDetected === true,
      pageCount: payload?.pageCount,
    });
  });
}

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ [ENABLED_KEY]: toggle.checked === true }, refresh);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.changmenExtensionRelease) refreshRelease();
  if (changes[ENABLED_KEY] || changes[STATUS_KEY]) refresh();
});

refresh();
setInterval(refresh, 1000);
