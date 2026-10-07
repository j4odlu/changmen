/**
 * Polymarket MARKET WebSocket Hub — 全站合并 asset 订阅，单条上游连 PM。
 * 浏览器仍连 /esport/ws-forward/PM-MARKET；PM-USER 保持 1:1 raw 转发。
 * 升级可带 JWT（?token= / Bearer）写入健康页归属；无 token / 校验失败仍放行（避免断采）。
 *
 * 下行策略（必须紫线 / 无法翻墙用户）：
 * - 行情只进 pending（同 asset 只留最新），禁止上游每 tick 立刻 flush
 * - 仅定时合批成单条 JSON 数组再 send（默认 100ms ≈ 10 batch/s）
 * - bufferedAmount 超过软阈值时本轮跳过，继续 coalesce，避免塞满 CN↔VPS 管线饿死同源 HTTP
 */
import { WebSocketServer, WebSocket } from "ws";
import { PM_MARKET_WS_URL } from "../platforms/pm.js";
import { recordConnect, recordDisconnect, recordError } from "./forward_stats.js";
import { attachHubUpstreamBackpressure, createWsRelayGuard } from "./ws_backpressure.js";
import { splitPmControlFrames, isPmHubThinFramesEnabled, pmHubQuoteTimestampMs, thinPmMarketFrames } from "./pm_hub_thin_frame.js";

/** @typedef {(token: string) => Promise<{ userId?: string, userName?: string } | null | undefined>} PmMarketIdentityResolver */

/** @type {PmMarketIdentityResolver | null} */
let identityResolver = null;
let hubAttached = false;

export const PM_MARKET_HUB_PATH = "/esport/ws-forward/PM-MARKET";
const HUB_ID = "PM-MARKET";
const UPSTREAM_PING_MS = 10_000;
const UPSTREAM_IDLE_MS = 60_000;

/** @typedef {{
 *   id: number,
 *   userId: string,
 *   userName: string,
 *   assetIds: Set<string>,
 *   connectedAt: number,
 *   lastSubscribeAt: number,
 *   lastBufferedAmount: number,
 *   droppedToClient: number,
 *   coalescedToClient: number,
 *   sentToClient: number,
 *   softSkipToClient: number,
 *   hardSkipToClient: number,
 *   pendingOldestAt: number,
 *   pendingByAsset: Map<string, string>,
 *   remoteAddress: string,
 *   xForwardedFor: string,
 *   userAgent: string,
 * }} HubClient */

/** pending flush 间隔（ms）；可用 PM_HUB_PENDING_FLUSH_MS 覆盖。默认 100≈10 batch/s。 */
export function resolvePendingFlushMs() {
  const n = Number(process.env.PM_HUB_PENDING_FLUSH_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 100;
}

/** @deprecated 读 resolvePendingFlushMs()；保留常量名供外部引用 */
export const PENDING_FLUSH_MS = 100;

/**
 * 软背压：bufferedAmount 超过此值则本轮不发、继续 coalesce。
 * 硬背压仍走 WS_FORWARD_MAX_BUFFERED_BYTES（默认 512KiB）。
 * 可用 PM_HUB_SOFT_BUFFERED_BYTES 覆盖。
 */
export function resolveSoftBufferedBytes() {
  const n = Number(process.env.PM_HUB_SOFT_BUFFERED_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 64 * 1024;
}

/**
 * 从 upgrade 请求提取 JWT（query token 优先，其次 Authorization Bearer / token 头）。
 * @param {{ url?: string, headers?: Record<string, string|string[]|undefined> }} request
 * @returns {string}
 */
export function extractPmMarketUpgradeToken(request) {
  try {
    const u = new URL(request?.url || "/", "http://localhost");
    const q = String(u.searchParams.get("token") || "").trim();
    if (q)
      return q;
  }
  catch { /* ignore */ }
  const headers = request?.headers || {};
  const rawAuth = headers.authorization ?? headers.Authorization;
  const auth = Array.isArray(rawAuth) ? String(rawAuth[0] || "") : String(rawAuth || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer?.[1])
    return bearer[1].trim();
  const rawTok = headers.token ?? headers.Token;
  const tok = Array.isArray(rawTok) ? String(rawTok[0] || "") : String(rawTok || "");
  return tok.trim();
}

function rejectUpgrade(socket, status = 401, reason = "Unauthorized") {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }
  catch { /* ignore */ }
  try {
    socket.destroy();
  }
  catch { /* ignore */ }
}

/** @type {WebSocketServer | null} */
let wss = null;
/** @type {Map<WebSocket, HubClient>} */
const clients = new Map();
/** @type {WebSocket | null} */
let upstream = null;
let upstreamPingTimer = null;
let upstreamIdleTimer = null;
let upstreamConnecting = false;
/** @type {Set<string>} */
let upstreamSubscribed = new Set();
let upstreamInitialPending = false;
let nextClientId = 1;

const toClientGuard = createWsRelayGuard(HUB_ID, "to-client");
/** @type {ReturnType<typeof setInterval> | null} */
let pendingFlushTimer = null;
/** @type {(() => void) | null} */
let stopHubBackpressure = null;
/** 软背压跳过 flush 累计（全 hub） */
let softSkipTotal = 0;
/** 硬背压（toClientGuard）跳过 flush 累计 */
let hardSkipTotal = 0;

function summarizeText(value, max = 120) {
  const s = String(value || "").trim();
  if (!s)
    return "";
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function detectRemoteAddress(request) {
  const forwarded = String(request?.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)[0];
  return forwarded
    || String(request?.headers?.["x-real-ip"] || "").trim()
    || String(request?.socket?.remoteAddress || "").trim()
    || "";
}

/**
 * 从 PM market 推送帧提取 asset_id（用于 fan-out 过滤）。
 * @param {string} raw
 * @returns {Set<string>}
 */
export function extractAssetIdsFromPmMarketMessage(raw) {
  const out = new Set();
  const text = String(raw ?? "").trim();
  if (!text || text === "PONG" || (!text.startsWith("{") && !text.startsWith("[")))
    return out;
  let parsed;
  try {
    parsed = JSON.parse(text);
  }
  catch {
    return out;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object")
      continue;
    if (msg.asset_id)
      out.add(String(msg.asset_id));
    if (Array.isArray(msg.price_changes)) {
      for (const change of msg.price_changes) {
        if (change?.asset_id)
          out.add(String(change.asset_id));
      }
    }
  }
  return out;
}

/** @param {Map<WebSocket, HubClient>} clientMap */
export function mergeHubAssetIds(clientMap) {
  const merged = new Set();
  for (const row of clientMap.values()) {
    for (const id of row.assetIds)
      merged.add(id);
  }
  return merged;
}

/**
 * 同 asset 只保留最新 raw；返回被覆盖次数（计入 coalesced）。
 * @param {Map<string, string>} pendingByAsset
 * @param {Iterable<string>} assetIds
 * @param {string} raw
 */
export function enqueueLatestByAsset(pendingByAsset, assetIds, raw) {
  let coalesced = 0;
  const incomingTs = pmHubQuoteTimestampMs(raw);
  for (const id of assetIds) {
    const key = String(id || "").trim();
    if (!key)
      continue;
    const prev = pendingByAsset.get(key);
    if (prev != null) {
      const prevTs = pmHubQuoteTimestampMs(prev);
      // 有交易所时间戳时，丢掉更旧的帧，避免晚到的便宜卖一盖住新价
      if (incomingTs > 0 && prevTs > incomingTs)
        continue;
      coalesced += 1;
    }
    pendingByAsset.set(key, raw);
  }
  return coalesced;
}

/** @param {string} raw */
export function pendingRawPriority(raw) {
  const s = String(raw || "");
  if (s.includes('"best_bid_ask"'))
    return 3;
  if (s.includes('"book"'))
    return 2;
  if (s.includes('"price_change"'))
    return 1;
  return 0;
}

/**
 * 取出 pending 中去重后的 raw 列表（优先 best_bid_ask），并清空 map。
 * @param {Map<string, string>} pendingByAsset
 * @returns {string[]}
 */
export function takePendingRawsDeduped(pendingByAsset) {
  if (!pendingByAsset.size)
    return [];
  const entries = [...pendingByAsset.entries()];
  pendingByAsset.clear();
  entries.sort((a, b) => pendingRawPriority(b[1]) - pendingRawPriority(a[1]));
  const seen = new Set();
  const out = [];
  for (const [, raw] of entries) {
    if (seen.has(raw))
      continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/**
 * 多条 pending raw → 单次 WS 下发 payload（数组帧；单条保持原样）。
 * 客户端 extractPolymarketWsBestAsks 已支持 JSON 数组。
 * @param {string[]} raws
 * @returns {string | null}
 */
export function buildBatchedPendingPayload(raws) {
  if (!Array.isArray(raws) || raws.length === 0)
    return null;
  if (raws.length === 1)
    return raws[0];
  /** @type {unknown[]} */
  const messages = [];
  for (const raw of raws) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed))
        messages.push(...parsed);
      else
        messages.push(parsed);
    }
    catch {
      /* 非 JSON 跳过；薄帧路径均为 JSON */
    }
  }
  if (!messages.length)
    return null;
  if (messages.length === 1)
    return JSON.stringify(messages[0]);
  return JSON.stringify(messages);
}

function stopPendingFlushTimer() {
  if (pendingFlushTimer) {
    clearInterval(pendingFlushTimer);
    pendingFlushTimer = null;
  }
}

function ensurePendingFlushTimer() {
  if (pendingFlushTimer)
    return;
  pendingFlushTimer = setInterval(() => {
    flushAllClientPending();
    let anyPending = false;
    for (const row of clients.values()) {
      if (row.pendingByAsset.size) {
        anyPending = true;
        break;
      }
    }
    if (!anyPending)
      stopPendingFlushTimer();
  }, resolvePendingFlushMs());
}

/**
 * @param {import("ws").WebSocket} clientWs
 * @param {HubClient} row
 */
function flushClientPending(clientWs, row) {
  if (!row.pendingByAsset.size)
    return;
  if (clientWs.readyState !== WebSocket.OPEN) {
    row.pendingByAsset.clear();
    row.pendingOldestAt = 0;
    return;
  }
  const buffered = Number(clientWs.bufferedAmount) || 0;
  row.lastBufferedAmount = buffered;
  // 软背压：管线未排空则本轮跳过，pending 继续 coalesce（不 take）
  if (buffered > resolveSoftBufferedBytes()) {
    row.softSkipToClient += 1;
    softSkipTotal += 1;
    ensurePendingFlushTimer();
    return;
  }
  if (!toClientGuard.isSendAllowed(clientWs)) {
    row.hardSkipToClient += 1;
    hardSkipTotal += 1;
    ensurePendingFlushTimer();
    return;
  }
  const raws = takePendingRawsDeduped(row.pendingByAsset);
  row.pendingOldestAt = 0;
  if (!raws.length)
    return;
  const payload = buildBatchedPendingPayload(raws);
  if (!payload) {
    row.droppedToClient += raws.length;
    return;
  }
  try {
    clientWs.send(payload);
    row.sentToClient += 1;
  }
  catch {
    for (const stuck of raws) {
      const ids = extractAssetIdsFromPmMarketMessage(stuck);
      if (ids.size) {
        enqueueLatestByAsset(row.pendingByAsset, ids, stuck);
        if (!row.pendingOldestAt)
          row.pendingOldestAt = Date.now();
      }
      else
        row.droppedToClient += 1;
    }
    ensurePendingFlushTimer();
  }
}

function flushAllClientPending() {
  for (const [clientWs, row] of clients)
    flushClientPending(clientWs, row);
}

/**
 * @param {import("ws").WebSocket} clientWs
 * @param {HubClient} row
 * @param {string} raw
 * @param {Set<string>} msgAssetIds
 * @param {boolean} broadcastAll
 */
function fanoutRawToClient(clientWs, row, raw, msgAssetIds, broadcastAll) {
  row.lastBufferedAmount = Number(clientWs.bufferedAmount) || 0;

  // 无 asset 的系统/广播帧：仍可立即发（先冲掉 pending 行情）
  if (broadcastAll || msgAssetIds.size === 0) {
    if (toClientGuard.isSendAllowed(clientWs) && row.pendingByAsset.size === 0) {
      row.sentToClient += 1;
      clientWs.send(raw);
      return;
    }
    if (toClientGuard.isSendAllowed(clientWs)) {
      flushClientPending(clientWs, row);
      if (toClientGuard.isSendAllowed(clientWs) && row.pendingByAsset.size === 0) {
        row.sentToClient += 1;
        clientWs.send(raw);
        return;
      }
    }
    row.droppedToClient += 1;
    return;
  }

  /** @type {string[]} */
  const keys = [];
  for (const id of msgAssetIds) {
    if (row.assetIds.has(id))
      keys.push(id);
  }
  if (!keys.length)
    return;

  // 行情：一律进 pending；仅定时器合批下发（禁止上游每 tick flush，否则 CN↔VPS 仍按消息率灌管）
  row.coalescedToClient += enqueueLatestByAsset(row.pendingByAsset, keys, raw);
  if (!row.pendingOldestAt)
    row.pendingOldestAt = Date.now();
  ensurePendingFlushTimer();
}

function setsEqual(a, b) {
  if (a.size !== b.size)
    return false;
  for (const v of a) {
    if (!b.has(v))
      return false;
  }
  return true;
}

function parseClientSubscribe(raw) {
  const text = String(raw ?? "").trim();
  if (!text)
    return null;
  if (text === "PING")
    return { kind: "ping" };
  if (!text.startsWith("{"))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  }
  catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object")
    return null;
  const ids = parsed.assets_ids ?? parsed.asset_ids;
  if (!Array.isArray(ids))
    return null;
  const assetIds = ids.map(id => String(id).trim()).filter(Boolean);
  return {
    kind: "subscribe",
    assetIds,
    initialDump: Boolean(parsed.initial_dump),
  };
}

function buildUpstreamSubscribe(assetIds, initialDump) {
  return JSON.stringify({
    assets_ids: [...assetIds],
    type: "market",
    custom_feature_enabled: true,
    initial_dump: initialDump,
  });
}

function clearUpstreamIdleTimer() {
  if (upstreamIdleTimer) {
    clearTimeout(upstreamIdleTimer);
    upstreamIdleTimer = null;
  }
}

function scheduleUpstreamIdleClose() {
  clearUpstreamIdleTimer();
  if (clients.size > 0)
    return;
  upstreamIdleTimer = setTimeout(() => {
    upstreamIdleTimer = null;
    if (clients.size === 0)
      closeUpstream("idle");
  }, UPSTREAM_IDLE_MS);
}

function stopUpstreamPing() {
  if (upstreamPingTimer) {
    clearInterval(upstreamPingTimer);
    upstreamPingTimer = null;
  }
}

function startUpstreamPing() {
  stopUpstreamPing();
  upstreamPingTimer = setInterval(() => {
    if (upstream?.readyState === WebSocket.OPEN)
      upstream.send("PING");
  }, UPSTREAM_PING_MS);
}

function closeUpstream(reason) {
  stopUpstreamPing();
  clearUpstreamReconnectTimer();
  upstreamConnecting = false;
  upstreamSubscribed = new Set();
  upstreamInitialPending = false;
  if (upstream) {
    try {
      upstream.close();
    }
    catch { /* ignore */ }
    upstream = null;
  }
  if (reason)
    console.warn(`[ws_forward/${HUB_ID}] upstream closed: ${reason}`);
}

function syncUpstreamSubscription(initialDump) {
  const merged = mergeHubAssetIds(clients);
  if (!merged.size) {
    upstreamSubscribed = new Set();
    if (upstream?.readyState === WebSocket.OPEN)
      closeUpstream("no assets");
    return;
  }
  const changed = !setsEqual(merged, upstreamSubscribed);
  if (!changed && !initialDump)
    return;
  if (!upstream || upstream.readyState !== WebSocket.OPEN) {
    upstreamInitialPending = initialDump || upstreamInitialPending;
    return;
  }
  upstream.send(buildUpstreamSubscribe(merged, initialDump || upstreamInitialPending));
  upstreamSubscribed = new Set(merged);
  upstreamInitialPending = false;
}

let upstreamReconnectTimer = null;
const UPSTREAM_RECONNECT_MS = 5_000;

function clearUpstreamReconnectTimer() {
  if (upstreamReconnectTimer) {
    clearTimeout(upstreamReconnectTimer);
    upstreamReconnectTimer = null;
  }
}

function scheduleUpstreamReconnect() {
  if (upstreamReconnectTimer || clients.size === 0)
    return;
  if (!mergeHubAssetIds(clients).size)
    return;
  upstreamReconnectTimer = setTimeout(() => {
    upstreamReconnectTimer = null;
    ensureUpstream();
  }, UPSTREAM_RECONNECT_MS);
}

function ensureUpstream() {
  if (upstream?.readyState === WebSocket.OPEN || upstreamConnecting)
    return;
  if (!mergeHubAssetIds(clients).size)
    return;

  upstreamConnecting = true;
  let ws;
  try {
    ws = new WebSocket(PM_MARKET_WS_URL);
  }
  catch (err) {
    upstreamConnecting = false;
    recordError(HUB_ID, err.message);
    return;
  }

  ws.on("open", () => {
    upstreamConnecting = false;
    upstream = ws;
    startUpstreamPing();
    const merged = mergeHubAssetIds(clients);
    const initial = upstreamInitialPending || merged.size > 0;
    if (merged.size) {
      ws.send(buildUpstreamSubscribe(merged, initial));
      upstreamSubscribed = new Set(merged);
    }
    upstreamInitialPending = false;
  });

  ws.on("message", (data, isBinary) => {
    let raw = isBinary ? data.toString() : String(data);
    if (raw === "PONG")
      return;
    const split = splitPmControlFrames(raw);
    for (const frame of split.controls) {
      for (const [clientWs, row] of clients) {
        if (clientWs.readyState !== WebSocket.OPEN || !row.assetIds.has(frame.assetId)) continue;
        if (!toClientGuard.isSendAllowed(clientWs)) { clientWs.close(1013, "tick control backpressure"); continue; }
        row.sentToClient++;
        clientWs.send(frame.raw);
      }
    }
    raw = split.quotes;
    if (!raw) return;
    // 不因慢客户端 pause/丢弃上游帧：扇出走 per-client coalesce，避免拖死全员

    // 瘦帧：按 asset 拆成独立 best_bid_ask，再扇出（与浏览器取价一致）
    if (isPmHubThinFramesEnabled()) {
      const frames = thinPmMarketFrames(raw);
      if (!frames.length)
        return;
      for (const [clientWs, row] of clients) {
        if (clientWs.readyState !== WebSocket.OPEN)
          continue;
        for (const frame of frames) {
          if (!row.assetIds.has(frame.assetId))
            continue;
          fanoutRawToClient(clientWs, row, frame.raw, new Set([frame.assetId]), false);
        }
      }
      return;
    }

    const assetIds = extractAssetIdsFromPmMarketMessage(raw);
    const broadcastAll = assetIds.size === 0;
    for (const [clientWs, row] of clients) {
      if (clientWs.readyState !== WebSocket.OPEN)
        continue;
      if (broadcastAll) {
        if (!row.assetIds.size)
          continue;
      }
      else {
        let hit = false;
        for (const id of assetIds) {
          if (row.assetIds.has(id)) {
            hit = true;
            break;
          }
        }
        if (!hit)
          continue;
      }
      fanoutRawToClient(clientWs, row, raw, assetIds, broadcastAll);
    }
  });

  ws.on("close", () => {
    if (upstream === ws)
      upstream = null;
    upstreamConnecting = false;
    upstreamSubscribed = new Set();
    stopUpstreamPing();
    scheduleUpstreamReconnect();
  });

  ws.on("error", (err) => {
    recordError(HUB_ID, err?.message || "upstream error");
  });
}

function onClientSubscribe(clientWs, assetIds, initialDump) {
  const row = clients.get(clientWs);
  if (!row)
    return;
  row.assetIds = new Set(assetIds);
  row.lastSubscribeAt = Date.now();
  syncUpstreamSubscription(initialDump);
  ensureUpstream();
}

function detachClient(clientWs) {
  if (!clients.has(clientWs))
    return;
  clients.delete(clientWs);
  recordDisconnect(HUB_ID);
  syncUpstreamSubscription(false);
  if (clients.size === 0)
    scheduleUpstreamIdleClose();
  else if (mergeHubAssetIds(clients).size > 0)
    ensureUpstream();
}

/**
 * @param {import("ws").WebSocket} clientWs
 * @param {import("node:http").IncomingMessage} request
 * @param {{ userId?: string, userName?: string }} [meta]
 */
function attachClient(clientWs, request, meta = {}) {
  clients.set(clientWs, {
    id: nextClientId++,
    userId: String(meta.userId || "").trim(),
    userName: String(meta.userName || "").trim(),
    assetIds: new Set(),
    connectedAt: Date.now(),
    lastSubscribeAt: 0,
    lastBufferedAmount: 0,
    droppedToClient: 0,
    coalescedToClient: 0,
    sentToClient: 0,
    softSkipToClient: 0,
    hardSkipToClient: 0,
    pendingOldestAt: 0,
    pendingByAsset: new Map(),
    remoteAddress: detectRemoteAddress(request),
    xForwardedFor: summarizeText(request?.headers?.["x-forwarded-for"] || "", 80),
    userAgent: summarizeText(request?.headers?.["user-agent"] || "", 120),
  });
  recordConnect(HUB_ID);
  clearUpstreamIdleTimer();

  clientWs.on("message", (data, isBinary) => {
    const raw = isBinary ? data.toString() : String(data);
    const parsed = parseClientSubscribe(raw);
    if (!parsed)
      return;
    if (parsed.kind === "ping") {
      if (clientWs.readyState === WebSocket.OPEN)
        clientWs.send("PONG");
      return;
    }
    onClientSubscribe(clientWs, parsed.assetIds, parsed.initialDump);
  });

  clientWs.on("close", () => {
    detachClient(clientWs);
  });

  clientWs.on("error", () => {
    detachClient(clientWs);
    try {
      clientWs.close();
    }
    catch { /* ignore */ }
  });
}

/**
 * @param {import("node:http").Server} httpServer
 * @param {{ resolveIdentity?: PmMarketIdentityResolver }} [opts]
 *   resolveIdentity 可选：有 token 时归因 userId/userName；失败/缺失仍放行连接（避免断采）。
 *   独立 hub 进程注入轻量 DB 解析；勿在此硬依赖 esport store（防拖入 matchMerge 副作用）。
 */
export function attachPmMarketHub(httpServer, opts = {}) {
  if (wss)
    return;

  identityResolver = typeof opts.resolveIdentity === "function" ? opts.resolveIdentity : null;
  hubAttached = true;

  wss = new WebSocketServer({ noServer: true });
  stopHubBackpressure?.();
  stopHubBackpressure = attachHubUpstreamBackpressure(
    () => clients.keys(),
    () => upstream,
    toClientGuard,
    HUB_ID,
  );

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (pathname !== PM_MARKET_HUB_PATH && !pathname.startsWith(`${PM_MARKET_HUB_PATH}/`))
      return;

    void (async () => {
      try {
        const token = extractPmMarketUpgradeToken(request);
        let userId = "";
        let userName = "";
        if (token && identityResolver) {
          try {
            const identity = await identityResolver(token);
            userId = String(identity?.userId || "").trim();
            userName = String(identity?.userName || "").trim();
            if (!userId) {
              recordError(HUB_ID, "upgrade identity: token present but invalid/expired");
            }
          }
          catch (err) {
            recordError(HUB_ID, err?.message || "upgrade identity error");
          }
        }
        if (!wss || socket.destroyed) {
          if (!socket.destroyed)
            rejectUpgrade(socket, 503, "Service Unavailable");
          return;
        }
        wss.handleUpgrade(request, socket, head, (clientWs) => {
          wss.emit("connection", clientWs, request, { userId, userName });
        });
      }
      catch (err) {
        recordError(HUB_ID, err?.message || "upgrade error");
        rejectUpgrade(socket, 500, "Internal Server Error");
      }
    })();
  });

  wss.on("connection", (clientWs, request, meta) => {
    attachClient(clientWs, request, meta || {});
  });
}

export function isPmMarketHubAttached() {
  return hubAttached && Boolean(wss);
}

export function getPmMarketHubStatus() {
  const now = Date.now();
  let pendingMaxAgeMs = 0;
  const rows = [...clients.values()].map((row) => {
    const pendingAgeMs = row.pendingOldestAt && row.pendingByAsset.size
      ? Math.max(0, now - row.pendingOldestAt)
      : 0;
    if (pendingAgeMs > pendingMaxAgeMs)
      pendingMaxAgeMs = pendingAgeMs;
    return {
      id: row.id,
      userId: row.userId || "",
      userName: row.userName || "",
      assetCount: row.assetIds.size,
      connectedForSec: Math.max(0, Math.round((now - row.connectedAt) / 1000)),
      idleSubscribeSec: row.lastSubscribeAt
        ? Math.max(0, Math.round((now - row.lastSubscribeAt) / 1000))
        : null,
      lastBufferedAmount: row.lastBufferedAmount,
      droppedToClient: row.droppedToClient,
      coalescedToClient: row.coalescedToClient,
      softSkipToClient: row.softSkipToClient,
      hardSkipToClient: row.hardSkipToClient,
      pendingAssets: row.pendingByAsset.size,
      pendingAgeMs,
      sentToClient: row.sentToClient,
      remoteAddress: row.remoteAddress,
      xForwardedFor: row.xForwardedFor,
      userAgent: row.userAgent,
    };
  });
  rows.sort((a, b) =>
    (b.softSkipToClient - a.softSkipToClient)
    || (b.pendingAgeMs - a.pendingAgeMs)
    || (b.droppedToClient - a.droppedToClient)
    || (b.pendingAssets - a.pendingAssets)
    || (b.lastBufferedAmount - a.lastBufferedAmount)
    || (b.assetCount - a.assetCount),
  );
  return {
    activeClients: rows.length,
    subscribedAssets: upstreamSubscribed.size,
    upstreamConnected: upstream?.readyState === WebSocket.OPEN,
    pendingFlushMs: resolvePendingFlushMs(),
    softBufferedBytes: resolveSoftBufferedBytes(),
    thinFrames: isPmHubThinFramesEnabled(),
    softSkipTotal,
    hardSkipTotal,
    pendingMaxAgeMs,
    slowClients: rows.slice(0, 10),
  };
}

export function closePmMarketHub() {
  stopPendingFlushTimer();
  clearUpstreamReconnectTimer();
  stopHubBackpressure?.();
  stopHubBackpressure = null;
  identityResolver = null;
  hubAttached = false;
  for (const clientWs of [...clients.keys()]) {
    try {
      clientWs.close();
    }
    catch { /* ignore */ }
  }
  clients.clear();
  softSkipTotal = 0;
  hardSkipTotal = 0;
  closeUpstream("shutdown");
  clearUpstreamIdleTimer();
  if (wss) {
    wss.close();
    wss = null;
  }
}

/** @internal 测试重置 */
export function resetPmMarketHubForTests() {
  closePmMarketHub();
}
