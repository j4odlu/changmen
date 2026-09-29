/** Polymarket 语义 API；实际出海路径由 pmTransport mode 决定 */

import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { POLYMARKET_CLOB_API } from "./api";
import {
  enrichPolymarketOrderTradeHashes,
  type PolymarketOrderHashFields,
  type PolymarketTradeHashRow,
} from "./pmTradeHashes";
import { pmEsportCall } from "./pmTransport";

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
  const result = await pmEsportCall<T>("Pm_SubmitOrder", esportBody(account, {
    playerId: requirePlayerId(account),
    order,
  }));
  if (!result || typeof result !== "object")
    return result;
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
