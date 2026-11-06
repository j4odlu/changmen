/** PM 订单同步调度：官方数据读取、缓存与来源识别；计算由独立快照模块负责。 */

import { collectPolymarketOrderTxHashes, flattenPolymarketTrades, aggregatePolymarketTrades, aggregatePolymarketSellTrades } from "./orderTradeProcessing";
export { collectPolymarketOrderTxHashes, isPolymarketTradeConfirmed, isUserMakerOrderLeg, polymarketTradeRefsOrderId, flattenPolymarketTrades, aggregatePolymarketTrades, aggregatePolymarketSellTrades } from "./orderTradeProcessing";
import { mapPolymarketTradeToVenueOrder } from "./orderTradeMapping";
export { mapPolymarketTradeToVenueOrder, mapPolymarketSellTradeToVenueOrder } from "./orderTradeMapping";
import type { PolymarketTradeRow } from "./orderTradeTypes";
export type { PolymarketTradeRow, PolymarketMakerOrderRow } from "./orderTradeTypes";
import { polymarketShareCount } from "./orderTradeAmounts";
export { polymarketBuyStakeUsdc, polymarketShareCount, parsePolymarketMicroUsdc, parsePolymarketBuyOrderFill, parsePolymarketSellOrderFill, polymarketTradeFillAmounts, polymarketTradeNotionalUsdc } from "./orderTradeAmounts";
export { applyPolymarketSettlement, findPolymarketWinnerIndex, resolvePolymarketOfficialWinningAssetId, resolvePolymarketSettlement, isPolymarketMarketResolved, resolvePolymarketWinningAssetId } from "./orderMarketSettlement";
export type { PolymarketSettlementKind, PolymarketSettlementResolution } from "./orderMarketSettlement";
import { reconcilePolymarketBuySellOrders } from "./orderSellAttribution";
export { reconcilePolymarketBuySellOrders } from "./orderSellAttribution";
import { updateStoredPolymarketOrderFromClob, updateStoredPolymarketOrderFromMarket, needsStoredMarketSettlement } from "./orderSyncUpdate";
export { changmenSoldOutBlocksGammaSettlement } from "./orderSyncUpdate";
import type { VenueOrder } from "@changmen/client-core/contract";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { collectPolymarketUserAddressesFromAccount } from "../../auth/l2Auth";
import type { PolymarketRawMarket } from "../../markets/parse";
import { hasOpenPolymarketPosition, stripPolymarketSellOrders } from "../positions/pmLogicalPosition";
import {
  markPolymarketOrdersSynced,
  PM_ORDER_FULL_LOOKBACK_MS,
  resolvePolymarketTradeLookbackMs,
} from "./pmOrderSync";
import { applyPolymarketOrderOrigins, isPolymarketChangmenOrder } from "../positions/pmOrigin";
import { enrichPolymarketBuyOrdersWithFees } from "../pmFee";
import { polymarketPluginGet } from "../../transport/transport";
import { lookupPolymarketOrderBetLabel, rememberPolymarketMarketBetLabel } from "../../markets/orderBetLabel";
import { storedMarketRefresh } from "./storedMarketRefresh";
import { enrichPolymarketOrderPrices } from "./pmOrderPrice";
import { readPolymarketTrades } from "../facts/tradeReader";
import { scalePolymarketVenueOrdersForDisplay } from "../facts/orderDisplayCurrency";
export { scalePolymarketVenueOrdersForDisplay } from "../facts/orderDisplayCurrency";
export { fetchPolymarketConfirmedTradeForOrder } from "../confirmation/tradeLookup";
export { resolvePolymarketBuyFill, resolvePolymarketSellFill, resolvePolymarketSellFillWithRetry, POLYMARKET_SELL_FILL_RETRY_OPTS } from "../confirmation/fillResolution";
import { createPolymarketOrderMarketReader } from "./orderMarketReader";

// Keep transport and cache publication in the synchronization host. Delegates
// preserve the live transport binding and the original publication timing.
const { read: fetchMarketsByConditionIds } = createPolymarketOrderMarketReader({
  get: <T>(url: string) => polymarketPluginGet<T>(url),
  publishMarket: market => rememberPolymarketMarketBetLabel(market),
});

export { lookupPolymarketOrderBetLabel } from "../../markets/orderBetLabel";

/** 订单 sync + 迟结算缓冲（Phase 2b） */
const ORDER_LOOKBACK_MS = PM_ORDER_FULL_LOOKBACK_MS;

function normalizeConditionId(id: string | undefined | null): string {
  return String(id ?? "").trim().toLowerCase();
}

function isChangmenPolymarketOrder(
  order: VenueOrder,
  stored: VenueOrder | undefined,
  playerId: number,
): boolean {
  return order.pmOrigin === "changmen"
    || stored?.pmOrigin === "changmen"
    || (playerId > 0 && isPolymarketChangmenOrder(playerId, order.orderId));
}

/**
 * CLOB 同步与 RDS changmen 行合并：
 * - changmen 买卖：以 RDS 绑定为准，CLOB 只刷新 fill/赛果
 * - changmen 卖单未 persist 前：跳过 CLOB 新建
 * - 其余：external + 份额匹配
 */
export function mergePolymarketClobWithStoredOrders(
  clobOrders: VenueOrder[],
  storedOrders: VenueOrder[],
  playerId: number,
  marketMap: Map<string, PolymarketRawMarket> = new Map(),
): VenueOrder[] {
  const storedById = new Map(storedOrders.map(o => [o.orderId, o]));
  const merged: VenueOrder[] = [];
  const usedStored = new Set<string>();

  for (const clob of clobOrders) {
    const stored = storedById.get(clob.orderId);
    const isCm = isChangmenPolymarketOrder(clob, stored, playerId);

    if (stored && isCm) {
      merged.push(updateStoredPolymarketOrderFromClob(
        stored, clob, lookupPolymarketOrderBetLabel(clob.pmConditionId, clob.pmTokenId),
      ));
      usedStored.add(clob.orderId);
      continue;
    }
    if (isCm && clob.pmSide === "sell") {
      // changmen 卖单尚未落库 — 勿从 CLOB 猜绑定
      continue;
    }
    if (isCm) {
      merged.push({ ...clob, pmOrigin: "changmen" });
      continue;
    }
    merged.push(clob);
  }

  for (const stored of storedOrders) {
    if (usedStored.has(stored.orderId))
      continue;
    if (stored.pmOrigin === "changmen" || (playerId > 0 && isPolymarketChangmenOrder(playerId, stored.orderId))) {
      const market = lookupGammaMarket(marketMap, { market: stored.pmConditionId, asset_id: stored.pmTokenId });
      const betLabel = lookupPolymarketOrderBetLabel(stored.pmConditionId, stored.pmTokenId);
      merged.push({ ...updateStoredPolymarketOrderFromMarket(stored, market, betLabel), bet: betLabel || stored.bet });
    }
  }

  return merged;
}

/** 标记来源 → 更新已有订单 → 仅官网卖单做份额归因 */
export function finalizePolymarketVenueOrders(
  clobOrders: VenueOrder[],
  playerId: number,
  storedOrders: VenueOrder[] = [],
  marketMap: Map<string, PolymarketRawMarket> = new Map(),
): VenueOrder[] {
  const account = { accountId: playerId } as PlatformAccount;
  const tagged = playerId > 0
    ? applyPolymarketOrderOrigins(account, stripPolymarketSellOrders(clobOrders))
    : stripPolymarketSellOrders(clobOrders);
  const merged = mergePolymarketClobWithStoredOrders(
    tagged,
    stripPolymarketSellOrders(storedOrders),
    playerId,
    marketMap,
  );
  return stripPolymarketSellOrders(reconcilePolymarketBuySellOrders(merged));
}

function lookupGammaMarket(
  marketMap: Map<string, PolymarketRawMarket>,
  trade: PolymarketTradeRow,
): PolymarketRawMarket | undefined {
  const conditionKey = normalizeConditionId(String(trade.market ?? ""));
  if (conditionKey && marketMap.has(conditionKey))
    return marketMap.get(conditionKey);
  const assetKey = normalizeConditionId(String(trade.asset_id ?? ""));
  if (assetKey && marketMap.has(`token:${assetKey}`))
    return marketMap.get(`token:${assetKey}`);
  return undefined;
}

/** CLOB /data/trades → VenueOrder bundle（lookback 可增量，合并靠 RDS stored） */
export async function fetchPolymarketVenueOrdersBundle(
  account: PlatformAccount,
  lookbackMs = ORDER_LOOKBACK_MS,
  storedOrders: VenueOrder[] = [],
): Promise<PolymarketVenueOrdersBundle> {
  const windowMs = Math.min(Math.max(Number(lookbackMs) || ORDER_LOOKBACK_MS, 60_000), ORDER_LOOKBACK_MS);
  const afterSec = Math.floor((Date.now() - windowMs) / 1000);
  const userAddresses = collectPolymarketUserAddressesFromAccount(account);
  let rawTrades: PolymarketTradeRow[];
  try {
    rawTrades = await readPolymarketTrades(account, afterSec);
  }
  catch {
    rawTrades = [];
  }
  const flattened = flattenPolymarketTrades(rawTrades, userAddresses);
  const buyPreview = aggregatePolymarketTrades(flattened);
  const sellPreview = aggregatePolymarketSellTrades(flattened);
  const preview = [...buyPreview, ...sellPreview].filter(
    trade => (Number(trade.match_time) || 0) >= afterSec,
  );
  // [changmen 扩展] trades 窗口会重复返回已确认旧单；它们的赛果同样只能走后台。
  // 新单、拒单翻正及新增成交份额仍保留原来的前台元数据确认。
  const storedById = new Map(storedOrders.map(order => [order.orderId, order]));
  const currentPreview = preview.filter(trade => {
    const stored = storedById.get(String(trade.taker_order_id ?? "").trim());
    return !stored || ["reject", "return", "pending"].includes(String(stored.status).toLowerCase())
      || !stored.pmTokenId || stored.pmTokenId !== String(trade.asset_id ?? "").trim()
      || normalizeConditionId(stored.pmConditionId) !== normalizeConditionId(trade.market)
      || !(Number(stored.pmShares) > 0)
      || polymarketShareCount(trade.size) > Number(stored.pmShares) + 0.0001;
  });
  const currentConditions = new Set(currentPreview.map(trade => normalizeConditionId(trade.market)).filter(Boolean));
  const currentTokens = new Set(currentPreview.map(trade => String(trade.asset_id ?? "").trim()).filter(Boolean));
  // [changmen 扩展] 历史赛果/名称后台补查；正常订单同步消费已取得的事实，不等待历史盘口。
  const storedMarketReads = storedOrders.filter(order => (needsStoredMarketSettlement(order)
    || !lookupPolymarketOrderBetLabel(order.pmConditionId, order.pmTokenId))
    && !currentConditions.has(normalizeConditionId(order.pmConditionId))
    && !currentTokens.has(String(order.pmTokenId ?? "").trim()));
  const historicalMarkets = storedMarketRefresh.read(storedMarketReads.map(order => ({
    conditionId: order.pmConditionId, tokenId: order.pmTokenId,
  })), fetchMarketsByConditionIds);
  const currentMarkets = await fetchMarketsByConditionIds(
    currentPreview.map(trade => String(trade.market ?? "")).filter(Boolean),
    currentPreview.map(trade => String(trade.asset_id ?? "")).filter(Boolean),
  );
  // 本轮成交查询优先于后台旧快照；不改变成交确认、费用和买卖归因。
  const marketMap = new Map([...historicalMarkets, ...currentMarkets]);
  return {
    orders: mapPolymarketTradesToVenueOrders(rawTrades, marketMap, afterSec, userAddresses),
    flattenedTrades: flattened,
    marketMap,
  };
}

export interface PolymarketVenueOrdersBundle {
  orders: VenueOrder[];
  flattenedTrades: PolymarketTradeRow[];
  marketMap: Map<string, PolymarketRawMarket>;
}

/** CLOB /data/trades → VenueOrder（近 3 天；Gamma resolve → win/lose） */
export async function fetchPolymarketVenueOrders(account: PlatformAccount): Promise<VenueOrder[]> {
  const bundle = await fetchPolymarketVenueOrdersBundle(account);
  return bundle.orders;
}

/**
 * [A8 对齐] provider.getOrders 唯一实现：CLOB + RDS changmen 合并 → 展示 CNY。
 * RDS 由 web 层 registerPolymarketStoredVenueOrdersLoader 注入。
 */
export async function fetchPolymarketVenueOrdersMerged(
  account: PlatformAccount,
): Promise<VenueOrder[]> {
  const { loadPolymarketStoredVenueOrders } = await import("./pmStoredOrders");
  const stored = await loadPolymarketStoredVenueOrders(account);
  const hasOpenStored = stored.some(o => hasOpenPolymarketPosition(o));
  const lookbackMs = resolvePolymarketTradeLookbackMs(account.accountId, hasOpenStored);
  const { orders, flattenedTrades, marketMap } = await fetchPolymarketVenueOrdersBundle(account, lookbackMs, stored);
  markPolymarketOrdersSynced(account.accountId, lookbackMs);
  const finalized = finalizePolymarketVenueOrders(orders, account.accountId, stored, marketMap);
  // 原单 → 全部成交 tx → 同钱包/资产 activity 含费成本；索引未齐保留原值，最后换算 CNY。
  const { parseTokenConfig, resolveFunder, normalizeEthAddress, collectPolymarketUserAddresses } =
    await import("../../auth/l2Auth");
  const cfg = parseTokenConfig(account.token);
  const funder = normalizeEthAddress(resolveFunder(cfg));
  const addrs = collectPolymarketUserAddresses(cfg);
  const proxyWallet = funder || [...addrs][0] || "";
  const txHashesByOrderId = collectPolymarketOrderTxHashes(flattenedTrades);
  const withFees = await enrichPolymarketBuyOrdersWithFees(finalized, {
    proxyWallet,
    txHashesByOrderId,
  });
  const withOrderPrices = await enrichPolymarketOrderPrices(account, withFees, stored);
  return scalePolymarketVenueOrdersForDisplay(withOrderPrices);
}

/** 纯映射（单测 / 调试）：CLOB trades → VenueOrder（买 + 卖） */
export function mapPolymarketTradesToVenueOrders(
  trades: PolymarketTradeRow[],
  marketMap: Map<string, PolymarketRawMarket> = new Map(),
  afterSec = 0,
  userAddresses?: ReadonlySet<string>,
): VenueOrder[] {
  const flattened = flattenPolymarketTrades(trades, userAddresses);
  const buyTrades = aggregatePolymarketTrades(flattened).filter(
    trade => !afterSec || (Number(trade.match_time) || 0) >= afterSec,
  );

  const orders: VenueOrder[] = [];
  for (const trade of buyTrades) {
    const mapped = mapPolymarketTradeToVenueOrder(
      trade,
      lookupGammaMarket(marketMap, trade),
    );
    if (mapped)
      orders.push(mapped);
  }
  // changmen 仓不在官网卖路径归因：CLOB SELL 成交不映射为 VenueOrder
  return finalizePolymarketVenueOrders(orders, 0);
}
