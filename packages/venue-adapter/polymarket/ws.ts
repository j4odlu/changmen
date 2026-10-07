import { notePmTickFrame } from "./pmTickState";
import { reportVenueWsMeta, reportVenueWsStatus } from "../shared/venueWsStatus";
import { resolvePolymarketMarketWsUrl } from "./wsConfig";
import {
  cyclePmMarketWsSourceMode,
  getPmMarketWsSourceMode,
  pmMarketWsSourceModeLabel,
  setPmMarketWsSourceMode,
  type PmMarketWsSourceMode,
} from "./pmMarketWsMode";
import { setPmUserWsSourceMode } from "./pmUserWsMode";
import { getPmRoutingPreference } from "./pmRoutingPreference";
import {
  getPmMarketClientMetricsSnapshot,
  notePmMarketClientConnectStart,
  notePmMarketClientConnected,
  notePmMarketClientEmptyBook,
  notePmMarketClientError,
  notePmMarketClientFallback,
  notePmMarketClientFrame,
  notePmMarketClientQuote,
  notePmMarketClientSubscription,
  resetPmMarketClientMetricsForTests,
} from "./pmMarketClientMetrics";

const WS_RECONNECT_MS = 5_000;
const WS_PING_MS = 10_000;
const WS_CONNECT_TIMEOUT_MS = 15_000;
const WS_HEARTBEAT_TIMEOUT_MS = 30_000;
const WS_STABLE_CONNECTION_MS = 30_000;
const OFFICIAL_FIRST_QUOTE_TIMEOUT_MS = 8_000;
/** 官方源连续失败后自动回退 CHANGMEN，避免国内网络卡在「未连接」 */
const OFFICIAL_FAIL_FALLBACK = 3;

export type PolymarketWsStatus = "disconnected" | "connecting" | "connected" | "error";
type PolymarketWsStatusListener = (status: PolymarketWsStatus) => void;

let polymarketWsStatus: PolymarketWsStatus = "disconnected";
const polymarketWsStatusListeners = new Set<PolymarketWsStatusListener>();
let officialFailStreak = 0;
let subscribedAssetCount = 0;

function reportPmMarketMeta(patch: Parameters<typeof reportVenueWsMeta>[1]) {
  const metrics = getPmMarketClientMetricsSnapshot();
  reportVenueWsMeta("pm-market", {
    sourceMode: getPmMarketWsSourceMode(),
    assetCount: subscribedAssetCount,
    failStreak: officialFailStreak,
    connectMs: metrics.connectMs,
    firstFrameMs: metrics.firstFrameMs,
    firstQuoteMs: metrics.firstQuoteMs,
    quoteFreshMs: metrics.quoteFreshMs,
    connectionAttemptCount: metrics.connectionAttemptCount,
    reconnectCount: metrics.reconnectCount,
    emptyBookCount: metrics.emptyBookCount,
    fallbackReason: metrics.fallbackReason,
    routingPreference: getPmRoutingPreference(),
    ...patch,
  });
}

function setPolymarketWsStatus(status: PolymarketWsStatus, reason?: string) {
  polymarketWsStatus = status;
  reportVenueWsStatus("pm-market", status);
  reportPmMarketMeta({ ...(reason ? { reason } : {}) });
  for (const fn of polymarketWsStatusListeners) fn(status);
}

export function getPolymarketWsStatus(): PolymarketWsStatus {
  return polymarketWsStatus;
}

export function onPolymarketWsStatus(fn: PolymarketWsStatusListener): () => void {
  polymarketWsStatusListeners.add(fn);
  return () => polymarketWsStatusListeners.delete(fn);
}

export interface PolymarketMarketWsHandle {
  send: (msg: string) => void;
  stop: () => void;
}

type MarketWsOpts = {
  onMessage: (raw: string) => void;
  onOpen: () => void;
};

/** 真实连接；cycle 换线会替换此引用 */
type ActiveMarketWsHandle = PolymarketMarketWsHandle & { updateSubscriptionWatchdog: () => void };
let activeMarketWsHandle: ActiveMarketWsHandle | null = null;
let activeMarketWsOpts: MarketWsOpts | null = null;

/** @internal vitest */
export function resetOfficialFailStreakForTests(): void {
  officialFailStreak = 0;
  subscribedAssetCount = 0;
  resetPmMarketClientMetricsForTests();
  reportPmMarketMeta({ reason: "test_reset", lastError: "", lastMessageAt: 0 });
}

function fallbackOfficialToChangmen(reason: string, error = ""): boolean {
  if (getPmMarketWsSourceMode() !== "official")
    return false;
  if (getPmRoutingPreference() !== "auto") {
    notePmMarketClientError(`manual_override_${reason}`, error);
    reportPmMarketMeta({ reason: `manual_override_${reason}`, lastError: error });
    return false;
  }
  officialFailStreak = 0;
  setPmMarketWsSourceMode("changmen");
  setPmUserWsSourceMode("changmen");
  notePmMarketClientFallback(reason, error);
  reportPmMarketMeta({ reason, lastError: error, failStreak: 0 });
  console.warn(`[Polymarket WS] official ${reason}, fallback to changmen relay`);
  return true;
}

function maybeFallbackOfficialToChangmen(reason: string, error = ""): boolean {
  if (getPmMarketWsSourceMode() !== "official") {
    officialFailStreak = 0;
    return false;
  }
  officialFailStreak += 1;
  notePmMarketClientError(reason, error);
  reportPmMarketMeta({ reason, lastError: error, failStreak: officialFailStreak });
  if (officialFailStreak < OFFICIAL_FAIL_FALLBACK)
    return false;
  return fallbackOfficialToChangmen("official_fail_fallback", error);
}

function isPolymarketQuoteFrame(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  }
  catch {
    return false;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object")
      continue;
    const row = msg as Record<string, unknown>;
    const eventType = String(row.event_type ?? "").trim();
    if (eventType === "best_bid_ask" && row.asset_id && row.best_ask !== undefined)
      return true;
    if (eventType === "price_change" && Array.isArray(row.price_changes) && row.price_changes.length > 0)
      return true;
    if (eventType === "book" && row.asset_id && Array.isArray(row.asks))
      return true;
  }
  return false;
}

function createPolymarketMarketWs(opts: MarketWsOpts): ActiveMarketWsHandle {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let officialFirstQuoteTimer: ReturnType<typeof setTimeout> | null = null;
  let receivedQuote = false;
  let connectedAt = 0;
  let lastReceivedAt = 0;
  let lastHeartbeatCheckAt = 0;
  let heartbeatGraceAt = 0;
  let connectionMode: PmMarketWsSourceMode = getPmMarketWsSourceMode();

  function clearOfficialFirstQuoteTimer() {
    if (officialFirstQuoteTimer) clearTimeout(officialFirstQuoteTimer);
    officialFirstQuoteTimer = null;
  }

  function clearConnectionTimers() {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = null;
    clearOfficialFirstQuoteTimer();
    clearPing();
  }

  function updateSubscriptionWatchdog() {
    if (stopped || ws?.readyState !== WebSocket.OPEN || connectionMode !== "official"
      || subscribedAssetCount <= 0 || receivedQuote) {
      clearOfficialFirstQuoteTimer();
      return;
    }
    // [changmen 扩展] 只等本连接首个盘口；订阅更新不能反复延长超时或把安静行情误判为断线。
    if (officialFirstQuoteTimer) return;
    officialFirstQuoteTimer = setTimeout(() => {
      officialFirstQuoteTimer = null;
      const error = `${subscribedAssetCount} subscribed assets had no book frame`;
      notePmMarketClientEmptyBook("official_no_book_timeout", error);
      if (fallbackOfficialToChangmen("official_no_book_timeout", error))
        reconnectNow();
    }, OFFICIAL_FIRST_QUOTE_TIMEOUT_MS);
  }

  function clearPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function clearActiveIfSelf(handle: PolymarketMarketWsHandle) {
    if (activeMarketWsHandle !== handle)
      return;
    activeMarketWsHandle = null;
    activeMarketWsOpts = null;
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, WS_RECONNECT_MS);
  }

  function reconnectNow() {
    if (stopped)
      return;
    clearConnectionTimers();
    const socket = ws;
    ws = null;
    try {
      socket?.close();
    }
    catch {
      /* ignore */
    }
    setPolymarketWsStatus("connecting", "fallback_reconnect");
    scheduleReconnect();
  }

  function failConnection(socket: WebSocket, reason: string, error: string) {
    if (stopped || ws !== socket) return;
    clearConnectionTimers();
    ws = null;
    notePmMarketClientError(reason, error);
    setPolymarketWsStatus("error", reason);
    reportPmMarketMeta({ lastError: error });
    maybeFallbackOfficialToChangmen(reason, error);
    try { socket.close(); } catch { /* ignore */ }
    scheduleReconnect();
  }

  function connect() {
    if (stopped || ws) return;
    notePmMarketClientConnectStart("connect_start");
    setPolymarketWsStatus("connecting", "connect_start");
    receivedQuote = false;
    connectedAt = 0;
    lastReceivedAt = 0;
    connectionMode = getPmMarketWsSourceMode();
    let socket: WebSocket;
    try {
      socket = new WebSocket(resolvePolymarketMarketWsUrl());
    }
    catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      notePmMarketClientError("socket_create_error", error);
      setPolymarketWsStatus("error", "socket_create_error");
      reportPmMarketMeta({ lastError: error });
      maybeFallbackOfficialToChangmen("socket_create_error", error);
      scheduleReconnect();
      return;
    }
    ws = socket;
    connectTimer = setTimeout(() => {
      failConnection(socket, "connect_timeout", `WebSocket handshake exceeded ${WS_CONNECT_TIMEOUT_MS}ms`);
    }, WS_CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      if (ws !== socket)
        return;
      if (connectTimer) clearTimeout(connectTimer);
      connectTimer = null;
      connectedAt = lastReceivedAt = Date.now();
      lastHeartbeatCheckAt = heartbeatGraceAt = connectedAt;
      notePmMarketClientConnected(getPmMarketWsSourceMode() === "official" ? "official_connected" : "changmen_connected");
      setPolymarketWsStatus("connected", getPmMarketWsSourceMode() === "official" ? "official_connected" : "changmen_connected");
      opts.onOpen();
      updateSubscriptionWatchdog();
      clearPing();
      pingTimer = setInterval(() => {
        if (ws !== socket || socket.readyState !== WebSocket.OPEN) return;
        const now = Date.now();
        // [changmen 扩展] 后台节流/电脑休眠后先发 PING，留出回复时间，避免恢复页面立即断线。
        if (now - lastHeartbeatCheckAt > WS_HEARTBEAT_TIMEOUT_MS)
          heartbeatGraceAt = now;
        lastHeartbeatCheckAt = now;
        if (now - Math.max(lastReceivedAt, heartbeatGraceAt) >= WS_HEARTBEAT_TIMEOUT_MS) {
          failConnection(socket, "heartbeat_timeout", `No WebSocket frame/PONG for ${WS_HEARTBEAT_TIMEOUT_MS}ms`);
          return;
        }
        try { socket.send("PING"); }
        catch (err) { failConnection(socket, "socket_send_error", String(err)); }
      }, WS_PING_MS);
    };

    socket.onmessage = (event) => {
      if (ws !== socket)
        return;
      const raw = String(event.data);
      lastReceivedAt = Date.now();
      // [changmen 扩展] 握手成功不等于线路稳定，短暂连接仍累计失败以触发自动回退。
      if (connectionMode === "official" && Date.now() - connectedAt >= WS_STABLE_CONNECTION_MS)
        officialFailStreak = 0;
      notePmTickFrame(raw);
      if (raw === "PONG") return;
      if (!raw.trim().startsWith("{") && !raw.trim().startsWith("[")) return;
      notePmMarketClientFrame();
      if (isPolymarketQuoteFrame(raw)) {
        receivedQuote = true;
        clearOfficialFirstQuoteTimer();
        reportPmMarketMeta({ lastMessageAt: Date.now(), reason: "book_frame", lastError: "" });
      }
      try {
        opts.onMessage(raw);
      } catch (err) {
        console.warn("[Polymarket WS] parse error", err);
      }
    };

    socket.onclose = (event) => {
      if (ws !== socket)
        return;
      failConnection(socket, "socket_close", `code=${event?.code ?? "unknown"}${event?.reason ? ` reason=${event.reason}` : ""}`);
    };

    socket.onerror = () => {
      if (ws !== socket)
        return;
      failConnection(socket, "socket_error", "WebSocket transport error");
    };
  }

  connect();

  const handle: ActiveMarketWsHandle = {
    updateSubscriptionWatchdog,
    send(msg: string) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearConnectionTimers();
      const socket = ws;
      ws = null;
      // 必须先取出再 close：若先 cleanup 置空，旧连接会成 hub 僵尸客户端
      try {
        socket?.close();
      }
      catch {
        /* ignore */
      }
      setPolymarketWsStatus("disconnected", "stopped");
      clearActiveIfSelf(handle);
    },
  };

  return handle;
}

/**
 * 稳定门面：collector 闭包持有此对象；cycle 换线只换底层 active，send 仍有效。
 * （否则 onOpen → subscribeTrackedAssets → 旧 handle.send 静默丢订阅，电竞/体育断价）
 */
function createMarketWsFacade(): PolymarketMarketWsHandle {
  return {
    send(msg: string) {
      activeMarketWsHandle?.send(msg);
    },
    stop() {
      activeMarketWsHandle?.stop();
    },
  };
}

/**
 * 启动 Polymarket CLOB market WebSocket，自动重连 + PING 心跳。
 * onOpen 在每次连接建立后调用（用于重新订阅资产）。
 * onMessage 接收原始字符串帧（已过滤 PONG）。
 */
export function startPolymarketMarketWs(opts: MarketWsOpts): PolymarketMarketWsHandle {
  activeMarketWsHandle?.stop();
  activeMarketWsOpts = opts;
  activeMarketWsHandle = createPolymarketMarketWs(opts);
  return createMarketWsFacade();
}

export { getPmMarketWsSourceMode, pmMarketWsSourceModeLabel };
export { getPmMarketClientMetricsSnapshot } from "./pmMarketClientMetrics";
export type { PmMarketWsSourceMode };

export function cyclePmMarketWsSourceModeAndReconnect(): PmMarketWsSourceMode {
  const next = cyclePmMarketWsSourceMode();
  reportPmMarketMeta({ reason: "manual_override", sourceMode: next, lastError: "" });
  const opts = activeMarketWsOpts;
  if (!opts)
    return next;

  activeMarketWsHandle?.stop();
  activeMarketWsOpts = opts;
  activeMarketWsHandle = createPolymarketMarketWs(opts);
  return next;
}

export function setPmMarketWsSourceModeAndReconnect(
  mode: PmMarketWsSourceMode,
  reason = "manual_override",
): PmMarketWsSourceMode {
  setPmMarketWsSourceMode(mode);
  reportPmMarketMeta({ reason, sourceMode: mode, lastError: "" });
  const opts = activeMarketWsOpts;
  if (!opts)
    return mode;

  activeMarketWsHandle?.stop();
  activeMarketWsOpts = opts;
  activeMarketWsHandle = createPolymarketMarketWs(opts);
  return mode;
}

export function notePolymarketMarketWsSubscription(assetCount: number): void {
  subscribedAssetCount = Math.max(0, Number(assetCount) || 0);
  notePmMarketClientSubscription(subscribedAssetCount);
  reportPmMarketMeta({ assetCount: subscribedAssetCount, reason: subscribedAssetCount ? "subscribed_assets" : "no_assets" });
  activeMarketWsHandle?.updateSubscriptionWatchdog();
}

export function notePolymarketMarketWsQuote(quoteTimestamp?: number): void {
  notePmMarketClientQuote(quoteTimestamp);
  reportPmMarketMeta({ lastMessageAt: Date.now(), reason: "quote", lastError: "" });
}
