/**
 * Polymarket 语义 Pm_* 处理器（VPS 直连 CLOB）
 */
import { normalizeAccountMultiplyField } from "@changmen/shared/account_multiply";
import { pmSubmitRejectionFromHttp } from "@changmen/shared/pm_submit_response";
import { clobClockInfo, prepareClobClock } from "./clob_clock.js";
import * as accountStore from "../../account/account_store.js";
import { assertPlayerOwnedByUser } from "../../account/player_ownership.js";
import { enrichAccountFromPlatformDefaults } from "../../account/balance_provider.js";
import * as dbStore from "../../db/store.js";
import store from "../../esport-api/store.js";
import { fetchPolymarketCollateralBalance } from "./balance.js";
import { isAllowedPolymarketUrl, executePolymarketHttpRequest, pickPolymarketPolyHeaders, PM_SUBMIT_ORDER_POST_TIMEOUT_MS } from "./clob_proxy.js";
import { fetchPolymarketTradesSince, fetchPolymarketTradesById } from "./clob_l2.js";

const DEFAULT_CLOB = "https://clob.polymarket.com";
const ORDER_PATH = "/order";
const TRADES_PATH = "/data/trades";
const ORDER_PATH_PREFIX = "/data/order/";
const HEARTBEAT_PATH = "/v1/heartbeats";
const OPEN_ORDERS_PATH = "/data/orders";

function parseBodyField(raw) {
  if (raw == null || raw === "")
    return undefined;
  if (typeof raw === "object")
    return raw;
  const text = String(raw).trim();
  if (!text)
    return undefined;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    }
    catch {
      return text;
    }
  }
  return text;
}

function findPolymarketAccountRow(accounts, playerId) {
  const want = String(playerId).trim();
  if (!want)
    return null;
  return accounts.find((row) => {
    const id = String(row.accountId ?? row.AccountId ?? "").trim();
    const provider = String(row.provider ?? "").trim().toLowerCase();
    return id === want && provider === "polymarket";
  }) ?? null;
}

function clobGateway(account) {
  return String(account?.gateway || DEFAULT_CLOB).replace(/\/+$/, "");
}

function parseUpstreamJson(result) {
  if (result.status >= 400) {
    const snippet = String(result.text || "").slice(0, 160) || `HTTP ${result.status}`;
    const err = new Error(snippet);
    err.status = result.status;
    err.rawText = result.text;
    throw err;
  }
  const text = String(result.text ?? "").trim();
  if (!text)
    return null;
  if (text.startsWith("{") || text.startsWith("["))
    return JSON.parse(text);
  return text;
}

/** [changmen 扩展] 私有读接口保留上游状态码，供客户端区分查空兜底与鉴权/服务错误。 */
function pmReadFailure(err) {
  const status = Number(err?.status);
  return { ok: false, msg: err instanceof Error ? err.message : String(err),
    ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { upstreamStatus: status } : {}) };
}

function extractHeartbeatId(raw) {
  if (!raw || typeof raw !== "object")
    return "";
  const id = raw.heartbeat_id ?? raw.heartbeatId;
  return id == null ? "" : String(id);
}

function extractHeartbeatIdFromError(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const rawText = err?.rawText;
  for (const source of [rawText, msg]) {
    if (!source)
      continue;
    const text = String(source);
    const jsonStart = text.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const id = extractHeartbeatId(JSON.parse(text.slice(jsonStart)));
        if (id)
          return id;
      }
      catch { /* ignore */ }
    }
  }
  const m = msg.match(/heartbeat_id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i);
  return m?.[1] ?? "";
}

async function resolveOwnedPmAccount(playerId, userId) {
  if (!userId)
    return { ok: false, msg: "请先登录" };
  if (playerId == null || String(playerId).trim() === "")
    return { ok: false, msg: "playerId 必填" };
  const owned = await assertPlayerOwnedByUser(playerId, userId);
  if (!owned.ok)
    return owned;
  await dbStore.refreshAccountsFromRdsIfEmpty(userId);
  const row = findPolymarketAccountRow(store.getAccountsForUser(userId), playerId);
  if (!row?.token)
    return { ok: false, msg: "PM 账号不存在或缺少 token" };
  return { ok: true, account: row };
}

function syncAccountRowInKv(accountId, updates, userId) {
  const list = userId ? store.getAccountsForUser(userId) : accountStore.getAccountsFromKv();
  const idx = list.findIndex(row => String(row.accountId) === String(accountId));
  if (idx < 0)
    return null;
  list[idx] = { ...list[idx], ...updates, updateTime: Date.now() };
  if (userId)
    store.setAccountsForUser(userId, list);
  return list[idx];
}

/** [changmen 扩展] Pm_HttpRequest：VPS 直连 Gamma/CLOB，不经 http-relay */
export async function handlePmHttpRequest(body, userId) {
  if (!userId)
    return { ok: false, msg: "请先登录" };

  const method = String(body.method || "GET").trim().toUpperCase();
  const url = String(body.url || "").trim();
  if (!url)
    return { ok: false, msg: "url 必填" };

  const l2Path = String(body.l2Path || "").trim();
  const playerId = body.playerId;
  let accountToken;
  if (playerId && l2Path) {
    const owned = await assertPlayerOwnedByUser(playerId, userId);
    if (!owned.ok)
      return owned;
    await dbStore.refreshAccountsFromRdsIfEmpty(userId);
    const row = findPolymarketAccountRow(store.getAccountsForUser(userId), playerId);
    if (!row?.token)
      return { ok: false, msg: "PM 账号不存在或缺少 token" };
    accountToken = row.token;
  }

  const polyHeaders = pickPolymarketPolyHeaders(parseBodyField(body.polyHeaders));
  if (l2Path && !accountToken && !polyHeaders)
    return { ok: false, msg: "L2 请求需要 playerId 或 polyHeaders" };

  try {
    const result = await executePolymarketHttpRequest({
      method,
      url,
      l2Path: l2Path || undefined,
      accountToken,
      polyHeaders,
      body: parseBodyField(body.body),
    });
    return { ok: true, info: result };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/** [changmen 扩展] Pm_RefreshBalance：VPS 直连 CLOB，不经 http-relay */
export async function handleRefreshPmBalance(body, userId) {
  const playerId = body.playerId;
  if (!playerId)
    return { ok: false, msg: "playerId 必填" };
  const owned = await assertPlayerOwnedByUser(playerId, userId);
  if (!owned.ok)
    return owned;
  const accounts = userId ? store.getAccountsForUser(userId) : accountStore.getAccountsFromKv();
  const row = normalizeAccountMultiplyField(
    accounts.find(r => String(r.accountId) === String(playerId)),
  );
  if (!row)
    return { ok: false, msg: "account 不存在" };
  if (String(row.provider ?? "").trim().toLowerCase() !== "polymarket")
    return { ok: false, msg: "仅 Polymarket 账号可用 Pm_RefreshBalance" };
  const enriched = enrichAccountFromPlatformDefaults(row);
  if (!enriched.token)
    return { ok: false, msg: "PM 账号缺少 token" };
  try {
    const bal = await fetchPolymarketCollateralBalance(enriched);
    if (!bal)
      return { ok: true, info: { ...row, balance: undefined } };
    const balance = Number(bal.balance) || 0;
    const credit = Number(row.credit) || 0;
    await accountStore.updatePlayerBalance(playerId, balance, userId);
    const synced = syncAccountRowInKv(playerId, {
      balance,
      currency: bal.currency || "USDT",
      totalProfit: balance - credit,
    }, userId);
    return { ok: true, info: { ...synced, balance } };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/** Pm_SubmitOrder */
export async function handlePmPrepareSubmit(body, userId) {
  const resolved = await resolveOwnedPmAccount(body.playerId, userId);
  if (!resolved.ok) return resolved;
  try {
    const gateway = clobGateway(resolved.account);
    if (!isAllowedPolymarketUrl(gateway)) throw new Error("URL 不在 Polymarket 允许列表");
    const leaseMs = await prepareClobClock(gateway);
    return { ok: true, info: { ready: true, leaseMs, ...clobClockInfo(gateway) } };
  } catch (err) { return { ok: false, msg: String(err.message || err) }; }
}

export async function handlePmSubmitOrder(body, userId) {
  const receivedAt = performance.now();
  const resolved = await resolveOwnedPmAccount(body.playerId, userId);
  if (!resolved.ok)
    return resolved;
  const order = parseBodyField(body.order);
  if (!order || typeof order !== "object")
    return { ok: false, msg: "order 必填" };
  try {
    const gateway = clobGateway(resolved.account);
    const outboundPrepareMs = performance.now() - receivedAt;
    const result = await executePolymarketHttpRequest({
      method: "POST",
      url: `${gateway}${ORDER_PATH}`,
      l2Path: ORDER_PATH,
      accountToken: resolved.account.token,
      body: order,
      timeoutMs: PM_SUBMIT_ORDER_POST_TIMEOUT_MS,
      clientL2Timestamp: body.clientL2Timestamp,
    });
    const rejection = pmSubmitRejectionFromHttp(result.status, result.text);
    if (rejection) return { ok: true, info: { ...rejection, pmTiming: result.timing } };
    return { ok: true, info: { ...parseUpstreamJson(result), pmTiming: { ...result.timing, outboundPrepareMs: outboundPrepareMs + (result.timing?.authMs || 0) } } };
  }
  catch (err) {
    if (err?.pmSubmitNotSent === true)
      return { ok: true, info: { success: false, errorMsg: err.message, pmSubmitNotSent: true } };
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/** Pm_GetTrades — after 时间窗，或 id=tradeID（官方 resolveTransactionsHashes） */
export async function handlePmGetTrades(body, userId) {
  const resolved = await resolveOwnedPmAccount(body.playerId, userId);
  if (!resolved.ok)
    return resolved;
  const tradeId = String(body.id ?? body.tradeId ?? body.tradeID ?? "").trim();
  try {
    if (tradeId) {
      const trades = await fetchPolymarketTradesById({
        token: resolved.account.token,
        gateway: clobGateway(resolved.account),
        tradeId,
      });
      return { ok: true, info: trades };
    }
    const afterSec = Number(body.after);
    if (!Number.isFinite(afterSec) || afterSec <= 0)
      return { ok: false, msg: "after 或 id 必填" };
    const maxPages = Math.min(Math.max(Number(body.maxPages) || 30, 1), 30);
    const trades = await fetchPolymarketTradesSince({
      token: resolved.account.token,
      gateway: clobGateway(resolved.account),
      afterSec: Math.floor(afterSec),
      maxPages,
    });
    return { ok: true, info: trades };
  }
  catch (err) {
    return pmReadFailure(err);
  }
}

/** Pm_GetOrder */
export async function handlePmGetOrder(body, userId) {
  const resolved = await resolveOwnedPmAccount(body.playerId, userId);
  if (!resolved.ok)
    return resolved;
  const orderId = String(body.orderId ?? "").trim();
  if (!orderId)
    return { ok: false, msg: "orderId 必填" };
  const path = `${ORDER_PATH_PREFIX}${orderId}`;
  try {
    const gateway = clobGateway(resolved.account);
    const result = await executePolymarketHttpRequest({
      method: "GET",
      url: `${gateway}${path}`,
      l2Path: path,
      accountToken: resolved.account.token,
    });
    return { ok: true, info: parseUpstreamJson(result) };
  }
  catch (err) {
    return pmReadFailure(err);
  }
}

/** Pm_Heartbeat — 维持 GTC open 订单 */
export async function handlePmHeartbeat(body, userId) {
  const resolved = await resolveOwnedPmAccount(body.playerId, userId);
  if (!resolved.ok)
    return resolved;
  const gateway = clobGateway(resolved.account);
  let heartbeatId = String(body.heartbeatId ?? body.heartbeat_id ?? "").trim();

  async function postOnce(id) {
    const payload = { heartbeat_id: id };
    const result = await executePolymarketHttpRequest({
      method: "POST",
      url: `${gateway}${HEARTBEAT_PATH}`,
      l2Path: HEARTBEAT_PATH,
      accountToken: resolved.account.token,
      body: payload,
    });
    return parseUpstreamJson(result);
  }

  try {
    const res = await postOnce(heartbeatId);
    const nextId = extractHeartbeatId(res) || heartbeatId;
    return { ok: true, info: { heartbeat_id: nextId } };
  }
  catch (err) {
    const recovered = extractHeartbeatIdFromError(err);
    if (!recovered)
      return { ok: false, msg: err instanceof Error ? err.message : String(err) };
    try {
      const res = await postOnce(recovered);
      const nextId = extractHeartbeatId(res) || recovered;
      return { ok: true, info: { heartbeat_id: nextId } };
    }
    catch (retryErr) {
      return { ok: false, msg: retryErr instanceof Error ? retryErr.message : String(retryErr) };
    }
  }
}

/** Pm_GetOpenOrders — 用户 open orders（可选 asset_id 过滤） */
export async function handlePmGetOpenOrders(body, userId) {
  const resolved = await resolveOwnedPmAccount(body.playerId, userId);
  if (!resolved.ok)
    return resolved;
  const gateway = clobGateway(resolved.account);
  const assetId = String(body.assetId ?? body.tokenId ?? "").trim();
  const qs = new URLSearchParams();
  if (assetId)
    qs.set("asset_id", assetId);
  if (body.id)
    qs.set("id", String(body.id));
  const l2Path = qs.toString() ? `${OPEN_ORDERS_PATH}?${qs.toString()}` : OPEN_ORDERS_PATH;
  try {
    const result = await executePolymarketHttpRequest({
      method: "GET",
      url: `${gateway}${l2Path}`,
      l2Path: OPEN_ORDERS_PATH,
      accountToken: resolved.account.token,
    });
    return { ok: true, info: parseUpstreamJson(result) };
  }
  catch (err) {
    return pmReadFailure(err);
  }
}

/** Pm_CancelOrder — DELETE /order { orderID } */
export async function handlePmCancelOrder(body, userId) {
  const resolved = await resolveOwnedPmAccount(body.playerId, userId);
  if (!resolved.ok)
    return resolved;
  const orderId = String(body.orderId ?? body.orderID ?? "").trim();
  if (!orderId)
    return { ok: false, msg: "orderId 必填" };
  try {
    const gateway = clobGateway(resolved.account);
    const payload = { orderID: orderId };
    const result = await executePolymarketHttpRequest({
      method: "DELETE",
      url: `${gateway}${ORDER_PATH}`,
      l2Path: ORDER_PATH,
      accountToken: resolved.account.token,
      body: payload,
    });
    return { ok: true, info: parseUpstreamJson(result) };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}

/** Pm_GetBook — 公开盘口，无 L2 */
export async function handlePmGetBook(body, userId) {
  void userId;
  const tokenId = String(body.tokenId ?? "").trim();
  if (!tokenId)
    return { ok: false, msg: "tokenId 必填" };
  const gateway = String(body.gateway || DEFAULT_CLOB).replace(/\/+$/, "");
  const params = new URLSearchParams({ token_id: tokenId });
  try {
    const result = await executePolymarketHttpRequest({
      method: "GET",
      url: `${gateway}/book?${params.toString()}`,
    });
    return { ok: true, info: parseUpstreamJson(result) };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : String(err) };
  }
}
