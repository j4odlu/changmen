import { recordPmExecutionMetric } from "./pmExecutionMetrics";
import { pmSubmitRejectionFromHttp } from "@changmen/shared/pm_submit_response";
/** Polymarket 语义 API；实际出海路径由 pmTransport mode 决定 */

import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { POLYMARKET_CLOB_API } from "./api";
import {
  enrichPolymarketOrderTradeHashes,
  type PolymarketOrderHashFields,
  type PolymarketTradeHashRow,
} from "./pmTradeHashes";
import { pmEsportCall } from "./pmTransport";
import { resolvePmOrderSubmitHttpMode } from "./pmOrderSubmitMode";
import { browserSubmitClockReady, prepareBrowserSubmitClock } from "./pmBrowserSubmitClock";

const clockLeases = new Map<string, number>();
const clockFlights = new Map<string, Promise<void>>();
function clockKey(account: PlatformAccount): string { return `${account.gateway}|${account.accountId}`; }
export function pmSubmitClockReady(account: PlatformAccount): boolean {
  return resolvePmOrderSubmitHttpMode() === "direct"
    ? browserSubmitClockReady(account.gateway)
    : (clockLeases.get(clockKey(account)) ?? 0) > performance.now();
}
export async function pmPrepareSubmit(account: PlatformAccount): Promise<void> {
  requirePlayerId(account);
  if (pmSubmitClockReady(account)) return;
  if (resolvePmOrderSubmitHttpMode() === "direct") {
    const start = performance.now();
    await prepareBrowserSubmitClock(account.gateway);
    recordPmExecutionMetric({ kind: "clock_sample", accountId: Number(account.accountId),
      ms: performance.now() - start, clockSource: "browser", httpMode: "direct", success: true });
    return;
  }
  const key = clockKey(account);
  if (clockFlights.has(key)) return clockFlights.get(key);
  const task = (async () => {
    const start = performance.now();
    const result = await pmEsportCall<{ ready: boolean; leaseMs: number; source?: string; sampleAgeMs?: number }>("Pm_PrepareSubmit", {
      playerId: requirePlayerId(account), _account: account,
    });
    if (!result?.ready || !(result.leaseMs > 0)) throw new Error("PM 提交校时未就绪");
    clockLeases.set(key, start + Math.min(result.leaseMs, 120_000));
    recordPmExecutionMetric({ kind: "clock_sample", accountId: Number(account.accountId),
      ms: performance.now() - start, clockSource: result.source, clockSampleAgeMs: result.sampleAgeMs, httpMode: "vps", success: true });
  })();
  clockFlights.set(key, task);
  try { await task; } finally { if (clockFlights.get(key) === task) clockFlights.delete(key); }
}

function requirePlayerId(account: PlatformAccount): number {
  const id = account.accountId;
  if (id == null || !Number(id))
    throw new Error("Polymarket 账号未保存（无 playerId）");
  return Number(id);
}

/** extension/direct 模式在浏览器侧 L2 签名，VPS 模式由 pmTransport 剥离 */
function esportBody(
  account: PlatformAccount | undefined,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  if (account)
    return { ...fields, _account: account };
  return fields;
}

export async function pmSubmitOrder<T = unknown>(
  account: PlatformAccount,
  order: unknown,
): Promise<T> {
  let result: T;
  const submitHttpMode = resolvePmOrderSubmitHttpMode();
  const leaseKey = clockKey(account);
  const submitStarted = performance.now();
  try {
    result = await pmEsportCall<T>("Pm_SubmitOrder", esportBody(account, {
      playerId: requirePlayerId(account),
      order,
    }));
    recordPmExecutionMetric({ kind: "submit_ack", accountId: Number(account.accountId),
      httpMode: submitHttpMode, ms: performance.now() - submitStarted, success: true });
  } catch (err) {
    recordPmExecutionMetric({ kind: "submit_ack", accountId: Number(account.accountId),
      httpMode: submitHttpMode, ms: performance.now() - submitStarted, success: false });
    const response = (err as { response?: { status?: number; data?: unknown } })?.response;
    const rejection = pmSubmitRejectionFromHttp(response?.status, response?.data);
    if (rejection) return rejection as T;
    // 服务端重启或时钟失效：只让下一次新预检重新准备，当前订单绝不自动重发。
    if ((err instanceof Error ? err.message : String(err)).includes("PM 提交校时未就绪"))
      clockLeases.delete(leaseKey);
    if ((err as { pmSubmitNotSent?: boolean })?.pmSubmitNotSent)
      return { success: false, errorMsg: err instanceof Error ? err.message : String(err), pmSubmitNotSent: true } as T;
    throw err;
  }
  if (!result || typeof result !== "object")
    return result;
  if ((result as { pmSubmitNotSent?: boolean }).pmSubmitNotSent)
    clockLeases.delete(leaseKey);
  const timing = (result as { pmTiming?: { authMs?: number; upstreamMs?: number; outboundPrepareMs?: number } }).pmTiming;
  if (timing) {
    if (Number.isFinite(timing.outboundPrepareMs)) recordPmExecutionMetric({ kind: "outbound_prepare", ms: timing.outboundPrepareMs, httpMode: submitHttpMode, success: true });
    if (Number.isFinite(timing.authMs)) recordPmExecutionMetric({ kind: "upstream_auth", ms: timing.authMs, httpMode: submitHttpMode, success: true });
    if (Number.isFinite(timing.upstreamMs)) recordPmExecutionMetric({ kind: "upstream_post", ms: timing.upstreamMs, httpMode: submitHttpMode, success: true });
  }
  return enrichPolymarketOrderTradeHashes(result as T & PolymarketOrderHashFields, {
    // 官方 clob-client-v2：getTrades({ id }, onlyFirstPage)
    fetchTradesById: async (tradeId) => {
      const rows = await pmGetTradesById(account, tradeId);
      return Array.isArray(rows) ? rows as PolymarketTradeHashRow[] : [];
    },
    intervalMs: 250,
    timeoutMs: 3_000,
  }) as Promise<T>;
}

export async function pmCancelOrder<T = unknown>(
  account: PlatformAccount,
  orderId: string,
): Promise<T> {
  return pmEsportCall<T>("Pm_CancelOrder", esportBody(account, {
    playerId: requirePlayerId(account),
    orderId: String(orderId).trim(),
  }));
}

export async function pmGetTrades<T = unknown>(
  account: PlatformAccount,
  afterSec: number,
  maxPages = 30,
): Promise<T> {
  return pmEsportCall<T>("Pm_GetTrades", esportBody(account, {
    playerId: requirePlayerId(account),
    after: Math.floor(afterSec),
    maxPages,
  }));
}

/** 官方 resolveTransactionsHashes：`GET /data/trades?id=<tradeID>` */
export async function pmGetTradesById(
  account: PlatformAccount,
  tradeId: string,
): Promise<PolymarketTradeHashRow[]> {
  const id = String(tradeId ?? "").trim();
  if (!id)
    return [];
  const rows = await pmEsportCall<unknown>("Pm_GetTrades", esportBody(account, {
    playerId: requirePlayerId(account),
    id,
  }));
  return Array.isArray(rows) ? rows as PolymarketTradeHashRow[] : [];
}

export async function pmGetOrder<T = unknown>(
  account: PlatformAccount,
  orderId: string,
): Promise<T> {
  return pmEsportCall<T>("Pm_GetOrder", esportBody(account, {
    playerId: requirePlayerId(account),
    orderId: String(orderId).trim(),
  }));
}

export async function pmGetBook<T = unknown>(
  tokenId: string,
  gateway = POLYMARKET_CLOB_API,
): Promise<T> {
  return pmEsportCall<T>("Pm_GetBook", {
    tokenId: String(tokenId).trim(),
    gateway,
  });
}

export async function pmPostHeartbeat(
  account: PlatformAccount,
  heartbeatId = "",
): Promise<{ heartbeat_id?: string; heartbeatId?: string }> {
  return pmEsportCall("Pm_Heartbeat", esportBody(account, {
    playerId: requirePlayerId(account),
    heartbeatId: String(heartbeatId ?? ""),
  }));
}

export async function pmGetOpenOrders<T = unknown>(
  account: PlatformAccount,
  assetId?: string,
  orderId?: string,
): Promise<T> {
  const fields: Record<string, unknown> = { playerId: requirePlayerId(account) };
  const id = String(assetId ?? "").trim();
  if (id)
    fields.assetId = id;
  if (orderId)
    fields.id = orderId;
  return pmEsportCall<T>("Pm_GetOpenOrders", esportBody(account, fields));
}
