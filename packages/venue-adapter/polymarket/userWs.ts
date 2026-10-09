import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { tracePolymarketOrder, tracePolymarketWsMessage } from "./orderTrace";
import { reportVenueWsStatus } from "../shared/venueWsStatus";
import type { PolymarketOrderRow } from "./orderTypes";
import { polymarketUserSubscribeMessage } from "./api";
import { resolvePolymarketUserWsUrl } from "./wsConfig";
import {
  cyclePmUserWsSourceMode,
  getPmUserWsSourceMode,
  pmUserWsSourceModeLabel,
  type PmUserWsSourceMode,
} from "./pmUserWsMode";
import { parseTokenConfig, resolveApiCreds } from "./l2Auth";
import {
  interpretPolymarketUserWsMessage,
  polymarketUserOrderIdsFromMessage,
  polymarketOrderRowFromUserWsMessage,
} from "./userWsMessages";

const WS_RECONNECT_MS = 5_000;
const WS_PING_MS = 10_000;
const DEFAULT_WATCH_TIMEOUT_MS = 45_000;

export interface PolymarketWsSettleResult {
  source: "ws";
  outcome: "matched" | "unfilled";
  row: PolymarketOrderRow | null;
}

interface WatchEntry {
  listeners: Set<(event: "update" | "connected") => void>;
  accountId?: number;
  accountKey: string;
  promise: Promise<PolymarketWsSettleResult | null>;
  settled: boolean;
  result: PolymarketWsSettleResult | null;
  resolve: (value: PolymarketWsSettleResult | null) => void;
}

interface UserWsSession {
  accountKey: string;
  auth: { apiKey: string; secret: string; passphrase: string };
  markets: Set<string>;
  ws: WebSocket | null;
  stopped: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  connected: boolean;
  recentMessages: { at: number; message: Record<string, unknown> }[];
}

const sessions = new Map<string, UserWsSession>();
const orderWatches = new Map<string, WatchEntry>();

function refreshPolymarketUserWsStatus(): void {
  if (!sessions.size) {
    reportVenueWsStatus("pm-user", "disconnected");
    return;
  }
  let status: "disconnected" | "connecting" | "connected" | "error" = "disconnected";
  for (const session of sessions.values()) {
    if (session.stopped)
      continue;
    if (session.connected) {
      status = "connected";
      break;
    }
    if (session.reconnectTimer)
      status = "error";
    else if (session.ws)
      status = "connecting";
  }
  reportVenueWsStatus("pm-user", status);
}

function sessionKeyFromAccount(account: PlatformAccount): string | null {
  const creds = resolveApiCreds(parseTokenConfig(account.token));
  const apiKey = String(creds.apiKey ?? "").trim();
  return apiKey || null;
}

function resolveSessionAuth(account: PlatformAccount) {
  const creds = resolveApiCreds(parseTokenConfig(account.token));
  const apiKey = String(creds.apiKey ?? "").trim();
  const secret = String(creds.secret ?? "").trim();
  const passphrase = String(creds.passphrase ?? "").trim();
  if (!apiKey || !secret || !passphrase)
    return null;
  return { apiKey, secret, passphrase };
}

function getOrCreateSession(account: PlatformAccount): UserWsSession | null {
  const accountKey = sessionKeyFromAccount(account);
  const auth = resolveSessionAuth(account);
  if (!accountKey || !auth)
    return null;

  let session = sessions.get(accountKey);
  if (!session) {
    session = {
      accountKey,
      auth,
      markets: new Set(),
      ws: null,
      stopped: false,
      reconnectTimer: null,
      pingTimer: null,
      connected: false,
      recentMessages: [],
    };
    sessions.set(accountKey, session);
  }
  return session;
}

function cleanupSessionTimers(session: UserWsSession) {
  if (session.pingTimer) {
    clearInterval(session.pingTimer);
    session.pingTimer = null;
  }
  session.ws = null;
  session.connected = false;
}

function sendJson(session: UserWsSession, payload: unknown) {
  if (session.ws?.readyState === WebSocket.OPEN)
    session.ws.send(JSON.stringify(payload));
}

function subscribeMarketOnSession(session: UserWsSession, conditionId: string) {
  const id = String(conditionId ?? "").trim();
  if (!id || session.markets.has(id))
    return;
  session.markets.add(id);
  // 用户流按账号订阅全部市场，不再动态缩窄过滤范围。
  ensureUserWsConnected(session);
}

function settleWatch(orderId: string, result: PolymarketWsSettleResult) {
  const entry = orderWatches.get(orderId);
  if (!entry)
    return;
  if (entry.result?.outcome === "matched") {
    if (result.outcome !== "matched")
      return;
    const previousSize = Number(entry.result.row?.size_matched) || 0;
    const nextSize = Number(result.row?.size_matched) || 0;
    if (nextSize < previousSize)
      return;
    result = { ...result, row: { ...entry.result.row, ...result.row,
      original_size: result.row?.original_size ?? entry.result.row?.original_size } };
  }
  entry.settled = true;
  entry.result = result;
  entry.resolve(result);
  for (const listener of entry.listeners)
    listener("update");
}

function dispatchUserWsMessage(session: UserWsSession, raw: string) {
  if (raw === "PONG" || !/^[\[{]/.test(raw.trim()))
    return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  }
  catch {
    return;
  }

  for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
    if (!message || typeof message !== "object")
      continue;
    const msg = message as Record<string, unknown>;
    // [changmen 扩展] 缓存 ACK 前到达的事件；只存当前鉴权会话，且限制容量。
    session.recentMessages = session.recentMessages.filter(x => Date.now() - x.at < 120_000);
    session.recentMessages.push({ at: Date.now(), message: msg });
    session.recentMessages = session.recentMessages.slice(-256);
    for (const [orderId, entry] of orderWatches) {
      if (entry.accountKey !== session.accountKey)
        continue;
      const outcome = interpretPolymarketUserWsMessage(msg, orderId);
      if (polymarketUserOrderIdsFromMessage(msg).some(id => id.toLowerCase() === orderId.toLowerCase()))
        tracePolymarketWsMessage(entry.accountId, orderId, msg, outcome, Date.now(), false);
      if (outcome)
        settleWatch(orderId, { source: "ws", outcome, row: polymarketOrderRowFromUserWsMessage(msg, outcome) });
    }
  }
}

function forceReconnectSession(session: UserWsSession) {
  if (session.stopped)
    return;
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
  const oldWs = session.ws;
  cleanupSessionTimers(session);
  oldWs?.close();
  ensureUserWsConnected(session);
}

function scheduleReconnect(session: UserWsSession) {
  if (session.stopped || session.reconnectTimer)
    return;
  refreshPolymarketUserWsStatus();
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    ensureUserWsConnected(session);
  }, WS_RECONNECT_MS);
}

function ensureUserWsConnected(session: UserWsSession) {
  if (session.stopped || session.ws)
    return;

  refreshPolymarketUserWsStatus();
  const ws = new WebSocket(resolvePolymarketUserWsUrl());
  session.ws = ws;

  ws.onopen = () => {
    if (session.ws !== ws)
      return;
    session.connected = true;
    for (const [id, entry] of orderWatches) {
      if (entry.accountKey === session.accountKey)
        tracePolymarketOrder(entry.accountId, id, "ws_open");
    }
    sendJson(session, polymarketUserSubscribeMessage(session.auth, []));
    for (const entry of orderWatches.values()) {
      if (entry.accountKey === session.accountKey) {
        for (const listener of entry.listeners)
          listener("connected");
      }
    }
    session.pingTimer = setInterval(() => {
      if (session.ws?.readyState === WebSocket.OPEN)
        session.ws.send("PING");
    }, WS_PING_MS);
    refreshPolymarketUserWsStatus();
  };

  ws.onmessage = (event) => {
    if (session.ws !== ws)
      return;
    dispatchUserWsMessage(session, String(event.data));
  };

  ws.onclose = () => {
    if (session.ws !== ws)
      return;
    for (const [id, entry] of orderWatches) {
      if (entry.accountKey === session.accountKey)
        tracePolymarketOrder(entry.accountId, id, "ws_close");
    }
    cleanupSessionTimers(session);
    refreshPolymarketUserWsStatus();
    scheduleReconnect(session);
  };

  ws.onerror = () => {
    if (session.ws !== ws)
      return;
    ws.close();
  };
}

/** 账号加载后预连 User WS，避免首笔 delayed 冷启动 */
export function warmPolymarketUserWs(account: PlatformAccount, conditionId?: string): boolean {
  if (account.provider !== "Polymarket")
    return false;
  const session = getOrCreateSession(account);
  if (!session)
    return false;
  ensureUserWsConnected(session);
  if (conditionId)
    subscribeMarketOnSession(session, conditionId);
  return true;
}

/** 对每个有效 PM 账户（按 apiKey 去重）预连 */
export function warmAllPolymarketUserWs(accounts: readonly PlatformAccount[]): void {
  const warmedKeys = new Set<string>();
  for (const account of accounts) {
    if (account.provider !== "Polymarket" || account.pause)
      continue;
    const key = sessionKeyFromAccount(account);
    if (!key || warmedKeys.has(key))
      continue;
    if (warmPolymarketUserWs(account))
      warmedKeys.add(key);
  }
}

/** delayed 下单后立即注册；conditionId = bet.SourceBetID */
export function registerPolymarketOrderWatch(
  account: PlatformAccount,
  orderId: string,
  opts: { conditionId: string; timeoutMs?: number },
): void {
  const id = String(orderId ?? "").trim();
  const conditionId = String(opts.conditionId ?? "").trim();
  if (!id)
    return;
  if (orderWatches.has(id))
    return;

  const session = getOrCreateSession(account);
  if (!session)
    return;

  let resolve!: (value: PolymarketWsSettleResult | null) => void;
  const promise = new Promise<PolymarketWsSettleResult | null>((res) => {
    resolve = res;
  });

  const entry: WatchEntry = {
    listeners: new Set(),
    accountId: account.accountId,
    accountKey: session.accountKey,
    promise,
    settled: false,
    result: null,
    resolve,
  };
  orderWatches.set(id, entry);
  tracePolymarketOrder(account.accountId, id, "watch", { status: session.connected ? "connected" : "connecting" });
  for (const cached of session.recentMessages) {
    if (Date.now() - cached.at >= 120_000)
      continue;
    const outcome = interpretPolymarketUserWsMessage(cached.message, id);
    if (polymarketUserOrderIdsFromMessage(cached.message).some(orderId => orderId.toLowerCase() === id.toLowerCase()))
      tracePolymarketWsMessage(entry.accountId, id, cached.message, outcome, cached.at, true);
    if (outcome) {
      settleWatch(id, { source: "ws", outcome, row: polymarketOrderRowFromUserWsMessage(cached.message, outcome) });
    }
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_WATCH_TIMEOUT_MS;
  setTimeout(() => {
    if (entry.settled)
      return;
    entry.settled = true;
    entry.result = null;
    tracePolymarketOrder(entry.accountId, id, "ws_timeout");
    resolve(null);
  }, timeoutMs);

  subscribeMarketOnSession(session, conditionId);
  ensureUserWsConnected(session);
}

/** [changmen 扩展] 持续通知迟到回执与重连；独立于首次等待 Promise 的超时。 */
export function observePolymarketOrderWatch(
  account: PlatformAccount,
  orderId: string,
  listener: (event: "update" | "connected") => void,
): () => void {
  registerPolymarketOrderWatch(account, orderId, { conditionId: "" });
  const entry = orderWatches.get(orderId.trim());
  if (!entry || entry.accountKey !== sessionKeyFromAccount(account))
    return () => {};
  entry.listeners.add(listener);
  if (entry.result)
    listener("update");
  return () => { entry.listeners.delete(listener); };
}

/** 拒单检测：等待已注册的 WS watch；无 watch 或超时 unresolved 返回 null → 走 REST 轮询 */
export async function awaitPolymarketOrderWatch(
  orderId: string,
  account?: PlatformAccount,
): Promise<PolymarketWsSettleResult | null> {
  const id = String(orderId ?? "").trim();
  if (!id)
    return null;
  const entry = orderWatches.get(id);
  if (!entry || (account && entry.accountKey !== sessionKeyFromAccount(account)))
    return null;
  if (entry.settled)
    return entry.result;
  return entry.promise;
}

export function clearPolymarketOrderWatch(orderId: string): void {
  const id = String(orderId ?? "").trim();
  if (id)
    orderWatches.delete(id);
}

/** [changmen 扩展] 包括首次等待超时后到达的结果，不重新等待 WS。 */
export function readPolymarketOrderWatch(orderId: string, account: PlatformAccount): PolymarketWsSettleResult | null {
  const entry = orderWatches.get(orderId);
  return entry?.accountKey === sessionKeyFromAccount(account) ? entry?.result ?? null : null;
}

export { getPmUserWsSourceMode, pmUserWsSourceModeLabel };
export type { PmUserWsSourceMode };

export function cyclePmUserWsSourceModeAndReconnect(): PmUserWsSourceMode {
  const next = cyclePmUserWsSourceMode();
  for (const session of sessions.values())
    forceReconnectSession(session);
  refreshPolymarketUserWsStatus();
  return next;
}

/** 单测 / 调试：断开所有 User WS */
export function stopAllPolymarketUserWs(): void {
  orderWatches.clear();
  void import("./settlementJob.js")
    .then(m => m.clearPolymarketSettlementJobs())
    .catch(() => {});
  void import("./pmHeartbeat.js")
    .then(m => m.stopAllPolymarketHeartbeats())
    .catch(() => {});
  for (const session of sessions.values()) {
    session.stopped = true;
    if (session.reconnectTimer)
      clearTimeout(session.reconnectTimer);
    const socket = session.ws;
    cleanupSessionTimers(session);
    socket?.close();
  }
  sessions.clear();
  refreshPolymarketUserWsStatus();
}
