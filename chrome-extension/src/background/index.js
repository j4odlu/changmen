/**
 * Gamebet Chrome 扩展 — Service Worker
 * 对齐 A8 externally_connectable 消息协议（changmen pluginBridge.ts）
 * 存储仅用 chrome.storage.local（Electron loadExtension 无 sync）
 */
import "./electron-storage-polyfill.js";
import { createExtensionUpdateChecks } from "./extension-updates.js";
createExtensionUpdateChecks().install();
import { createPmWalletSessionHandler, isPmWalletStorageKey } from "./pm-wallet-session.js";
const handlePmWalletSession = createPmWalletSessionHandler();
import {
  initModifyHeaderListener,
  MODIFY_HEADER_KEY,
  applyModifyHeaderRules,
} from "./modify-header.js";
import { axiosRequest } from "./http.js";
import { storageGet, storageSet } from "./storage.js";
import { attachObSportWsPort, handleObSportWsEvent, installObSportWsBackground, OB_SPORT_WS_PORT } from "./ob-sport-ws.js";
import { attachPodAlertsPort, ingestPodAlertsMessage, POD_ALERTS_PORT } from "./pod-alerts.js";
import { attachStakeOddsPort, handleStakeOddsPush, STAKE_ODDS_PORT } from "./stake-odds.js";
import { isPbWsObserveLive, isPbWsSocketOpen, mergePbWsBoards } from "../pb-ws-observe.js";
import {
  hostnameMatchesPbAccountHosts,
  normalizePbAccountHosts,
  PB_ACCOUNT_HOSTS_KEY,
  pickPbLiveTabIds,
  tabUrlMatchesPbAccountHosts,
} from "../content/pb/hosts.js";

const MANIFEST = chrome.runtime.getManifest();

const PB_WS_STATUS_KEY = "pbWsObserve";
const PB_WS_ENABLED_KEY = "pbWsObserveEnabled";
const PB_WS_BOARD_KEY = "pbWsLatestOdds";
const PB_WS_MAX_RECENT = 40;
const PB_LIVE_HTTP_PORT = "pb-live-http";

/** @typedef {{ port: chrome.runtime.Port; host: string; href: string; frameId?: number; venueMemberId?: string }} PbLivePortEntry */
/** @type {Map<number, PbLivePortEntry[]>} */
const pbLivePorts = new Map();

function rememberPbLivePort(port) {
  const tabId = port.sender?.tab?.id;
  if (!tabId) return;
  /** @type {PbLivePortEntry} */
  const entry = {
    port,
    host: "",
    href: "",
    frameId: port.sender?.frameId,
    venueMemberId: "",
  };
  const list = (pbLivePorts.get(tabId) || []).filter((e) => e.port !== port);
  list.push(entry);
  pbLivePorts.set(tabId, list);
  port.onMessage.addListener((msg) => {
    if (msg?.kind === "hello") {
      entry.host = typeof msg.host === "string" ? msg.host : "";
      entry.href = typeof msg.href === "string" ? msg.href : "";
      entry.venueMemberId = typeof msg.venueMemberId === "string" ? msg.venueMemberId : "";
    }
  });
  port.onDisconnect.addListener(() => {
    const next = (pbLivePorts.get(tabId) || []).filter((e) => e.port !== port);
    if (next.length)
      pbLivePorts.set(tabId, next);
    else
      pbLivePorts.delete(tabId);
  });
}

function pbMembersEqual(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function pickPbLivePort(tabId, requestUrl = "", venueMemberId = "") {
  const entries = pbLivePorts.get(tabId) || [];
  if (!entries.length) return undefined;
  const want = String(venueMemberId || "").trim();
  if (want) {
    const byMember = entries.find((e) => pbMembersEqual(e.venueMemberId, want));
    if (byMember)
      return byMember.port;
  }
  let reqHost = "";
  try {
    if (requestUrl)
      reqHost = new URL(requestUrl).hostname;
  }
  catch {
    /* ignore */
  }
  if (reqHost) {
    const hit = entries.find((e) => hostnameMatchesPbAccountHosts(e.host, [reqHost]));
    if (hit)
      return hit.port;
  }
  return entries[0]?.port;
}

function tabIdFromPbLivePorts(hosts, venueMemberId = "") {
  const list = normalizePbAccountHosts(hosts);
  const want = String(venueMemberId || "").trim();
  let hostHit;
  for (const [tabId, entries] of pbLivePorts) {
    for (const e of entries) {
      const hostOk = !list.length
        || hostnameMatchesPbAccountHosts(e.host, list)
        || tabUrlMatchesPbAccountHosts(e.href, list);
      if (!hostOk)
        continue;
      if (want && pbMembersEqual(e.venueMemberId, want))
        return tabId;
      if (hostHit == null)
        hostHit = tabId;
    }
  }
  return want ? undefined : hostHit;
}

function pbLivePortDebug(hosts) {
  const list = normalizePbAccountHosts(hosts);
  const ports = [];
  for (const [tabId, entries] of pbLivePorts) {
    for (const e of entries) {
      ports.push({
        tabId,
        host: e.host,
        href: e.href || "",
        venueMemberId: e.venueMemberId || "",
      });
    }
  }
  return { hosts: list, ports };
}

function pingPbLiveTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "pbLiveTabPing" }, (response) => {
      void chrome.runtime.lastError;
      resolve({
        host: response && typeof response.host === "string" ? response.host : "",
        venueMemberId: response && typeof response.venueMemberId === "string" ? response.venueMemberId : "",
      });
    });
  });
}

function isHttpTabUrl(url) {
  return !url || /^https?:/i.test(url);
}

/** 按粘贴 referer/gateway 主机找官网页。勿用 query({ url })（缺 tabs 权限会空集）。 */
async function queryTabsForPbAccountHosts(hosts) {
  const list = normalizePbAccountHosts(hosts);
  if (!list.length) return new Set();
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  }
  catch {
    return new Set();
  }

  const urlMatched = [];
  const pingCandidates = [];
  for (const t of tabs) {
    if (!t.id) continue;
    const url = t.url || t.pendingUrl || "";
    if (!isHttpTabUrl(url)) continue;
    pingCandidates.push(t);
    if (tabUrlMatchesPbAccountHosts(url, list))
      urlMatched.push(t);
  }

  const pingHosts = {};
  const toPing = urlMatched.length ? urlMatched : pingCandidates;
  await Promise.all(toPing.map(async (t) => {
    const ping = await pingPbLiveTab(t.id);
    if (ping.host)
      pingHosts[t.id] = ping.host;
  }));
  return new Set(pickPbLiveTabIds(tabs, list, pingHosts));
}

/**
 * 先 ping 官网自己登记的 PB tab（不依赖 tabs.query 权限），再按粘贴主机扫页。
 * 有 venueMemberId 时优先同会员标签，避免同站两个登录串号。
 * @param {string[]} hosts
 * @param {string} [venueMemberId]
 * @returns {Promise<number | null>}
 */
async function resolvePbLiveTabId(hosts, venueMemberId = "") {
  const list = normalizePbAccountHosts(hosts);
  const want = String(venueMemberId || "").trim();
  const fromPort = tabIdFromPbLivePorts(list, want);
  if (fromPort)
    return fromPort;
  const storedPb = Number((await storageGet("PB"))?.PB);
  if (Number.isFinite(storedPb) && storedPb > 0) {
    const ping = await pingPbLiveTab(storedPb);
    if (ping.host && (!list.length || hostnameMatchesPbAccountHosts(ping.host, list))) {
      if (!want || pbMembersEqual(ping.venueMemberId, want))
        return storedPb;
    }
  }
  if (!list.length)
    return Number.isFinite(storedPb) && storedPb > 0 ? storedPb : null;
  const tabIds = await queryTabsForPbAccountHosts(list);
  if (want) {
    for (const id of tabIds) {
      const ping = await pingPbLiveTab(id);
      if (pbMembersEqual(ping.venueMemberId, want))
        return id;
    }
  }
  if (Number.isFinite(storedPb) && storedPb > 0 && tabIds.has(storedPb))
    return storedPb;
  const first = [...tabIds][0];
  return typeof first === "number" ? first : null;
}

function forwardViaPbLivePort(port, message) {
  const uuid = message.uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      port.onMessage.removeListener(onMsg);
      reject(new Error("标签页通信失败"));
    }, 30_000);
    function onMsg(msg) {
      if (!msg || msg.kind !== "httpResult" || msg.uuid !== uuid)
        return;
      clearTimeout(timer);
      port.onMessage.removeListener(onMsg);
      if (msg.error)
        reject(new Error(String(msg.error)));
      else
        resolve(msg.response);
    }
    port.onMessage.addListener(onMsg);
    try {
      port.postMessage({ ...message, kind: "http", uuid });
    }
    catch (err) {
      clearTimeout(timer);
      port.onMessage.removeListener(onMsg);
      reject(err instanceof Error ? err : new Error("标签页通信失败"));
    }
  });
}

/**
 * @param {object} frame
 */
async function appendPbWsFrame(frame) {
  // 与 mergePbWsStatus 并发时，勿用过期 cur 盖掉较新的 latestOdds
  const bag = await storageGet([PB_WS_STATUS_KEY, PB_WS_BOARD_KEY]);
  const cur = bag?.[PB_WS_STATUS_KEY] || {};
  const boardCards = bag?.[PB_WS_BOARD_KEY]?.cards;
  const recent = Array.isArray(cur.recent) ? cur.recent.slice() : [];
  recent.push(frame);
  while (recent.length > PB_WS_MAX_RECENT) recent.shift();
  /** @type {Record<string, unknown>} */
  const next = {
    ...cur,
    recent,
    frameCount: (cur.frameCount || 0) + 1,
    lastType: frame?.type || cur.lastType,
    updatedAt: Date.now(),
  };
  if (Array.isArray(boardCards)) next.latestOdds = boardCards;
  await storageSet({ [PB_WS_STATUS_KEY]: next });
}

/**
 * @param {object} status
 */
async function mergePbWsStatus(status) {
  const cur = (await storageGet([PB_WS_STATUS_KEY, PB_WS_BOARD_KEY])) || {};
  const curStatus = cur?.[PB_WS_STATUS_KEY] || {};
  const curBoard = cur?.[PB_WS_BOARD_KEY];
  const incomingClosed =
    status?.phase === "off"
    || status?.phase === "hook_stop"
    || status?.phase === "ws_closed"
    || status?.via === "closed";
  const incomingOpen =
    status?.connected === true || Number(status?.readyState) === 1;
  const incomingLive = isPbWsObserveLive(status);
  const curOpen = isPbWsSocketOpen(curStatus);
  const next = {
    ...curStatus,
    ...status,
    recent: curStatus.recent || [],
    updatedAt: Date.now(),
  };
  // 多 frame：顶栏 euro/odds flush 没有 sports WS，不得把 iframe 的已连接打成断开
  if (!incomingClosed && !incomingLive) {
    if (curOpen) {
      next.connected = true;
      if (curStatus.readyState != null) next.readyState = curStatus.readyState;
      if (curStatus.phase === "connected") next.phase = "connected";
      if (curStatus.lastType) {
        next.lastType = curStatus.lastType;
        next.lastDestination = curStatus.lastDestination;
      }
      next.frameCount = Math.max(Number(curStatus.frameCount) || 0, Number(status?.frameCount) || 0);
    } else if (status?.socketSeen !== true && !incomingOpen) {
      if (curStatus.connected === true || Number(curStatus.readyState) === 1) {
        next.connected = true;
        if (Number(curStatus.readyState) === 1) next.readyState = curStatus.readyState;
      } else if (!("connected" in (status || {}))) {
        next.connected = curStatus.connected;
        if (next.readyState == null) next.readyState = curStatus.readyState;
      }
      if (!status?.lastType && curStatus.lastType) {
        next.lastType = curStatus.lastType;
        next.lastDestination = curStatus.lastDestination;
      }
      next.frameCount = Math.max(Number(curStatus.frameCount) || 0, Number(status?.frameCount) || 0);
    }
    const curOut = Array.isArray(curStatus.subscribedOut) ? curStatus.subscribedOut : [];
    const inOut = Array.isArray(status?.subscribedOut) ? status.subscribedOut : [];
    if (curOut.length && inOut.length === 0) {
      next.subscribedOut = curStatus.subscribedOut;
      next.inboundDest = curStatus.inboundDest;
      next.inboundTypeCount = curStatus.inboundTypeCount;
      next.checklist = curStatus.checklist;
    }
  }
  if (incomingClosed) {
    next.connected = false;
    if (status?.readyState != null) next.readyState = status.readyState;
  } else if (incomingOpen) {
    next.connected = true;
  }
  const curCards = Array.isArray(curBoard?.cards)
    ? curBoard.cards
    : Array.isArray(curStatus.latestOdds)
      ? curStatus.latestOdds
      : [];
  const wipeBoard = status?.phase === "off" || status?.phase === "hook_stop";
  if (wipeBoard) {
    next.latestOdds = Array.isArray(status?.latestOdds) ? status.latestOdds : [];
  } else if (Array.isArray(status?.latestOdds) && status.latestOdds.length) {
    next.latestOdds = mergePbWsBoards(
      curCards,
      status.latestOdds,
      incomingLive,
      !incomingLive && !curOpen && !incomingClosed,
    );
    next.boardSeq = Math.max(
      Number(status.boardSeq) || 0,
      Number(curStatus.boardSeq) || 0,
      Number(curBoard?.boardSeq) || 0,
    );
  } else if (curCards.length) {
    next.latestOdds = curCards;
  }
  // 成功挂接后清掉历史 close，避免弹窗一直显示 close=1006
  if (status?.lastClose == null && (status?.phase === "hooked" || status?.phase === "connected" || status?.connected === true)) {
    next.lastClose = null;
    if (!status.lastError) next.lastError = "";
  }
  const patch = { [PB_WS_STATUS_KEY]: next };
  if (wipeBoard || (Array.isArray(next.latestOdds) && next.latestOdds.length)) {
    patch[PB_WS_BOARD_KEY] = {
      cards: next.latestOdds || [],
      updatedAt: Date.now(),
      boardSeq: Number(next.boardSeq) || 0,
    };
  }
  await storageSet(patch);
}

/** @typedef {{ type: string; uuid?: string; url?: string; data?: unknown; options?: TabRequestOptions }} ExternalMessage */
/** @typedef {{ tabId?: number; headers?: Record<string, string>; timeout?: number; withCredentials?: boolean; platform?: string; provider?: string; venueMemberId?: string }} TabRequestOptions */

/**
 * @param {ExternalMessage} message
 * @param {number} tabId
 * @returns {Promise<unknown>}
 */
function forwardToTab(message, tabId) {
  const viaPort = pickPbLivePort(tabId, message.url, message.options?.venueMemberId);
  if (viaPort)
    return forwardViaPbLivePort(viaPort, message);
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "标签页通信失败"));
        return;
      }
      if (response && typeof response === "object" && "response" in response) {
        resolve(response.response);
        return;
      }
      resolve(response);
    });
  });
}

/**
 * @param {ExternalMessage} message
 * @param {(payload: object) => void} reply
 * @param {chrome.runtime.MessageSender} [sender]
 */
async function handleExternalMessage(message, reply, sender) {
  const { type, uuid } = message;

  switch (type) {
      case "GET":
      case "POST":
      case "DELETE":
      case "GET_CONFIG":
      case "": {
      const tabId = message.options?.tabId;
      if (tabId) {
        try {
          const response = await forwardToTab(message, tabId);
          reply({ type, uuid, response });
        } catch (err) {
          reply({
            type,
            uuid,
            response: err instanceof Error ? (err.message || "标签页通信失败") : String(err),
          });
        }
        return;
      }
      try {
        const response = await axiosRequest(message);
        reply({ type, uuid, response });
      } catch (err) {
        reply({ type, uuid, response: err });
      }
      return;
    }
    case "version":
      reply({
        type,
        uuid,
        response: { name: MANIFEST.name, version: MANIFEST.version },
      });
      return;
    case "proxy":
      /* A8 legacy：占位，无实现 */
      reply({ type, uuid, response: null });
      return;
    case "getStore": {
      const key = message.data?.key;
      if (isPmWalletStorageKey(key)) { reply({ type, uuid, response: { data: {} } }); return; }
      if (!key) {
        reply({ type, uuid, response: { data: {} } });
        return;
      }
      const data = await storageGet(key);
      reply({ type, uuid, response: { data } });
      return;
    }
    case "getPbLiveTab": {
      const hosts = normalizePbAccountHosts(message.data?.hosts);
      const venueMemberId = String(message.data?.venueMemberId || "").trim();
      const tabId = await resolvePbLiveTabId(hosts, venueMemberId);
      reply({
        type,
        uuid,
        response: {
          tabId: typeof tabId === "number" ? tabId : null,
          debug: pbLivePortDebug(hosts),
        },
      });
      return;
    }
    case "setStore": {
      const payload = message.data;
      if (isPmWalletStorageKey(payload?.key)) { reply({ type, uuid, response: {} }); return; }
      if (payload?.key != null) {
        await storageSet({ [payload.key]: payload.data });
        if (payload.key === MODIFY_HEADER_KEY) {
          await applyModifyHeaderRules(payload.data ?? []);
        }
      }
      reply({ type, uuid, response: {} });
      return;
    }
    case "setTab": {
      // [A8 可证实] external：data.value = tabId，storage[key]=tabId，response=data
      const tabId = sender?.tab?.id;
      const payload = message.data;
      if (tabId && payload?.key) {
        const response = { ...payload, value: tabId, tabId };
        await storageSet({ [payload.key]: tabId });
        reply({ type, uuid, response });
        return;
      }
      reply({ type, uuid, response: null });
      return;
    }
    case "pbWsObserveGet": {
      const incomingHosts = Array.isArray(message.data?.hosts)
        ? normalizePbAccountHosts(message.data.hosts)
        : null;
      if (incomingHosts)
        await storageSet({ [PB_ACCOUNT_HOSTS_KEY]: incomingHosts });
      const bag = await storageGet([
        PB_WS_STATUS_KEY,
        PB_WS_ENABLED_KEY,
        PB_WS_BOARD_KEY,
        PB_ACCOUNT_HOSTS_KEY,
        "PB",
      ]);
      const observe = bag?.[PB_WS_STATUS_KEY] || null;
      const board = bag?.[PB_WS_BOARD_KEY];
      let latestOdds = Array.isArray(board?.cards)
        ? board.cards
        : Array.isArray(observe?.latestOdds)
          ? observe.latestOdds
          : [];
      const hosts = incomingHosts || normalizePbAccountHosts(bag?.[PB_ACCOUNT_HOSTS_KEY]);
      const tabIds = await queryTabsForPbAccountHosts(hosts);
      const pageCount = tabIds.size;
      const storedPb = Number(bag?.PB);
      if (Number.isFinite(storedPb) && storedPb > 0) tabIds.add(storedPb);
      let observeOut = observe ? { ...observe, latestOdds } : { latestOdds };
      for (const id of tabIds) {
        try {
          const live = await chrome.tabs.sendMessage(id, { type: "pbWsObserveBoardGet" });
          if (!live || typeof live !== "object") continue;
          const liveWs = isPbWsObserveLive(live);
          if (Array.isArray(live.latestOdds) && live.latestOdds.length) {
            latestOdds = mergePbWsBoards(
              latestOdds,
              live.latestOdds,
              liveWs,
              !liveWs && !isPbWsSocketOpen(observeOut),
            );
          }
          observeOut = { ...observeOut, latestOdds };
          if (liveWs) {
            observeOut.connected = true;
            if (live.readyState != null) observeOut.readyState = live.readyState;
            if (live.phase) observeOut.phase = live.phase;
            if (live.lastType) observeOut.lastType = live.lastType;
            if (live.frameCount != null) observeOut.frameCount = live.frameCount;
            break;
          }
          if (live.lastType) {
            observeOut.lastType = live.lastType;
            if (live.frameCount != null) observeOut.frameCount = live.frameCount;
          }
        } catch {
          /* 该 tab 未注入 content */
        }
      }
      reply({
        type,
        uuid,
        response: {
          enabled: bag?.[PB_WS_ENABLED_KEY] !== false,
          pageDetected: pageCount > 0,
          pageCount,
          observe: observeOut,
        },
      });
      return;
    }
    case "pbWsObserveSet": {
      const enabled = message.data?.enabled === true;
      await storageSet({ [PB_WS_ENABLED_KEY]: enabled });
      reply({ type, uuid, response: { enabled } });
      return;
    }
    default:
      reply({ type, uuid, response: null });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port?.name === PB_LIVE_HTTP_PORT)
    rememberPbLivePort(port);
  if (port?.name === STAKE_ODDS_PORT)
    attachStakeOddsPort(port);
});

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port?.name === OB_SPORT_WS_PORT)
    attachObSportWsPort(port);
  if (port?.name === POD_ALERTS_PORT)
    attachPodAlertsPort(port);
  if (port?.name === STAKE_ODDS_PORT)
    attachStakeOddsPort(port);
});

installObSportWsBackground();

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  if (String(message.type).startsWith("pmWalletSession:")) {
    if (!["pmWalletSession:restore", "pmWalletSession:save", "pmWalletSession:lock", "pmWalletSession:remove"].includes(message.type)) return false;
    void handlePmWalletSession(message, sender).then(response => sendResponse({ type: message.type, uuid: message.uuid, response }));
    return true;
  }
  handleExternalMessage(message, sendResponse, sender);
  return true;
});

/** content script 内 setTab / PB WS 观测帧 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (handleStakeOddsPush(message)) {
    sendResponse({ ok: true });
    return false;
  }
  if (handleObSportWsEvent(message)) {
    sendResponse({ ok: true });
    return true;
  }
  if (ingestPodAlertsMessage(message)) {
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "pbWsObserveFrame") {
    void appendPbWsFrame(message.frame).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "pbWsObserveStatus") {
    void mergePbWsStatus(message.status || {}).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "pbWsObserveGet") {
    void handleExternalMessage(message, sendResponse, sender);
    return true;
  }
  if (message?.type === "pbLiveCredential") {
    const payload = message.data;
    if (!payload || typeof payload !== "object" || typeof payload.token !== "string") {
      sendResponse({ ok: false });
      return true;
    }
    void storageSet({ PB_LIVE_CREDENTIAL: payload }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type !== "setTab") return false;
  const tabId = sender.tab?.id;
  const key = message.data?.key;
  if (!tabId || !key) {
    sendResponse({ success: false, type: message.type, uuid: message.uuid, response: "No tabId or key" });
    return true;
  }
  const patch = { [key]: tabId };
  const host = typeof message.data?.host === "string" ? message.data.host : "";
  if (key === "PB" && host) {
    patch.pbLiveTabMeta = { tabId, host, href: message.data?.href || "", ts: Date.now() };
  }
  storageSet(patch).then(() => {
    sendResponse({
      success: true,
      type: message.type,
      uuid: message.uuid,
      response: { ...message.data, key, tabId, value: tabId },
    });
  });
  return true;
});

initModifyHeaderListener();

/** 点击工具栏图标：优先侧边栏；无 Side Panel API 时回退 popup（如部分 Electron） */
async function initActionUi() {
  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      await chrome.action.setPopup({ popup: "" });
      return;
    } catch (err) {
      console.warn("[sidePanel]", err);
    }
  }
  try {
    await chrome.action.setPopup({ popup: "popup.html" });
  } catch (err) {
    console.warn("[action.setPopup]", err);
  }
}
void initActionUi();
