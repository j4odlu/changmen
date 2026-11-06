/** 市场快照到单笔订单结算；不读网络、缓存、账号或浏览器存储。 */
import type { VenueOrder } from "@changmen/client-core/contract";
import { polymarketMarketAssetIds, polymarketMarketHasAsset, polymarketMarketAssetForOutcome, polymarketOfficialWinner, polymarketConditionsAgree } from "@changmen/shared/pm_market_assets";
import { polymarketEqualSplitResolved, polymarketEqualSplitAmounts, polymarketFinalPayout, polymarketVerifiedOrderPayout } from "@changmen/shared/pm_settlement";
import { parseJsonArray, type PolymarketRawMarket } from "../../markets/parse";
import { resolvePmFillShares } from "../positions/pmLogicalPosition";
import { polymarketShareCount, round4 } from "./orderTradeAmounts";
import type { PolymarketTradeRow } from "./orderTradeTypes";

/** [changmen 扩展] 用户授权恢复价格提前判定；官方赢家始终优先。 */
const WINNER_PRICE_MIN = 0.99;

export function findPolymarketWinnerIndex(prices: number[]): number {
  if (prices.length < 2 || prices.some(price => !Number.isFinite(price) || price < 0 || price > 1))
    return -1;
  const winners = prices.flatMap((price, index) => price >= WINNER_PRICE_MIN ? [index] : []);
  return winners.length === 1 ? winners[0]! : -1;
}

export type PolymarketSettlementKind = "official" | "price" | "equal_split";

export type PolymarketSettlementResolution = {
  winningAssetId: string | null;
  /** official：隐藏卖出；price：提前判定但保留卖出。 */
  kind: PolymarketSettlementKind;
};

/**
 * 官方结算：CLOB `tokens[].winner === true` 的 token_id。
 */
export function resolvePolymarketOfficialWinningAssetId(
  market: PolymarketRawMarket | undefined,
): string | null {
  return polymarketOfficialWinner(market).assetId;
}

/**
 * [changmen 扩展] 优先官方 `tokens[].winner`，否则按 outcomePrices ≥ 0.99 提前判定。
 * closed / proposed 本身不作为赛果；价格与 token 必须完整、一一对应。
 */
export function resolvePolymarketSettlement(
  market: PolymarketRawMarket | undefined,
): PolymarketSettlementResolution | null {
  if (!market) return null;
  if (polymarketEqualSplitResolved(market))
    return { winningAssetId: null, kind: "equal_split" };
  const { assetId: official, ambiguous } = polymarketOfficialWinner(market);
  if (ambiguous) return null;
  if (official)
    return { winningAssetId: official, kind: "official" };

  const prices = parseJsonArray(market.outcomePrices ?? market.outcome_prices).map(Number);
  const ids = polymarketMarketAssetIds(market);
  if (prices.length !== ids.length || ids.some(id => !id.trim()) || new Set(ids).size !== ids.length)
    return null;
  const index = findPolymarketWinnerIndex(prices);
  const winningAssetId = index >= 0 ? ids[index]?.trim() : undefined;
  return winningAssetId ? { winningAssetId, kind: "price" } : null;
}

/** 市场是否已有官方赢家或价格提前判定结果。 */
export function isPolymarketMarketResolved(market: PolymarketRawMarket | undefined): boolean {
  return resolvePolymarketSettlement(market) != null;
}

/** 已 resolve 市场的赢家 token id */
export function resolvePolymarketWinningAssetId(market: PolymarketRawMarket | undefined): string | null {
  return resolvePolymarketSettlement(market)?.winningAssetId ?? null;
}

export function tradeHeldAssetId(trade: PolymarketTradeRow, market?: PolymarketRawMarket): string {
  const assetId = String(trade.asset_id ?? "").trim();
  if (assetId) return assetId;
  return polymarketMarketAssetForOutcome(market, trade.outcome);
}

/**
 * 持有买单结算 → win/lose + money/reward；并始终写入 pmMatchResult（赛果）。
 * - official：`pmSellState=settled`（侧栏隐藏卖出）；已 closed/partial 不改卖出状态
 * - price：提前判赢/输，保留原卖出状态及卖出能力
 * - 已卖光（剩余份额≈0）：只写 pmMatchResult，不动 status/money（盈亏已在卖出路径）
 * 已部分卖出时按剩余份数/剩余本金计盈亏，避免用满仓份额虚增。
 */
export function applyPolymarketSettlement(
  order: VenueOrder,
  trade: PolymarketTradeRow,
  market?: PolymarketRawMarket,
): VenueOrder {
  const resolved = resolvePolymarketSettlement(market);
  if (!resolved) return order;

  const heldAssetId = tradeHeldAssetId(trade, market);
  if ((order.pmTokenId && String(order.pmTokenId).trim() !== heldAssetId)
    || !polymarketConditionsAgree(order.pmConditionId, trade.market, market?.conditionId, market?.condition_id)) return order;
  if (!polymarketMarketHasAsset(market, heldAssetId)
    || (resolved.winningAssetId && !polymarketMarketHasAsset(market, resolved.winningAssetId))) return order;

  const settlement = polymarketFinalPayout(market, heldAssetId);
  if (resolved.kind === "equal_split") return settlePolymarketEqualSplitOrder(order, settlement);
  if (resolved.kind === "price" && polymarketVerifiedOrderPayout(order) !== undefined) return order;

  const matchResult: "win" | "lose" = heldAssetId === resolved.winningAssetId ? "win" : "lose";

  const fillShares = Number(order.pmShares) > 0.0001
    ? Number(order.pmShares)
    : polymarketShareCount(trade.size);
  const attributed = Number(order.pmAttributedSellShares) || 0;
  const trackedPartial = attributed > 0
    || order.pmSellState === "partial"
    || order.pmSellState === "closed";
  const shares = trackedPartial
    ? Math.max(0, fillShares - attributed)
    : polymarketShareCount(trade.size);
  const stake = Number(order.pmStakeUsdc) > 0
    ? Number(order.pmStakeUsdc)
    : order.betMoney;

  const nextSellState = resolved.kind === "official"
    ? (order.pmSellState === "closed" ? "closed" : "settled")
    : (order.pmSellState ?? "open");

  const base: VenueOrder = {
    ...order,
    pmMatchResult: matchResult,
    pmSellState: nextSellState,
    ...(settlement ? { pmSettlement: settlement } : {}),
  };

  // 已卖光：赛果独立落库，不改盈亏字段
  if (shares <= 0.0001 || stake <= 0)
    return base;

  if (matchResult === "win") {
    const reward = Math.round(shares * 10000) / 10000;
    const money = Math.round((reward - stake) * 10000) / 10000;
    return { ...base, status: "win", reward, money };
  }

  return { ...base, status: "lose", reward: 0, money: -stake };
}

/** [changmen 扩展] Final payout determines money; financial Win/Lose does not label the match winner. */
export function settlePolymarketEqualSplitOrder(order: VenueOrder, settlement?: VenueOrder["pmSettlement"]): VenueOrder {
  if (order.pmSide === "sell") return order;
  const shares = resolvePmFillShares(order);
  const attr = Number(order.pmAttributedSellShares ?? 0);
  if (!(shares > 0) || !Number.isFinite(attr) || attr < 0 || attr > shares + 0.01) return order;
  const base = { ...order, pmMatchResult: "equal_split" as const, ...(settlement ? { pmSettlement: settlement } : {}) };
  // Keep the official fill precision until cash is rounded; rounding shares first can change the payout.
  const remaining = Math.max(0, shares - attr);
  if (order.pmSellState === "closed" || (attr > 0 && remaining <= 0.01)) return base;
  const sold = attr > 0 || order.pmSellState === "partial";
  const stake = Number(order.pmStakeUsdc);
  const originalCost = Number(order.betMoney);
  const remainingCost = sold ? stake : Math.max(Number.isFinite(stake) ? stake : 0, originalCost);
  if (!Number.isFinite(remainingCost) || remainingCost < 0 || (!sold && remainingCost <= 0)) return order;
  let realized = 0;
  if (sold) {
    if (order.pmRealizedPnlUsdc != null && Number.isFinite(Number(order.pmRealizedPnlUsdc)))
      realized = Number(order.pmRealizedPnlUsdc);
    else if (order.pmSellProceeds != null && Number.isFinite(Number(order.pmSellProceeds)) && originalCost > 0)
      realized = round4(Number(order.pmSellProceeds) - (originalCost - remainingCost));
    else if (order.pmMatchResult === "win" || order.pmMatchResult === "lose")
      realized = round4(order.money - (order.pmMatchResult === "win" ? remaining - remainingCost : -remainingCost));
    else if (order.status === "none" && Number.isFinite(order.money)) realized = order.money;
    else return order;
  }
  const amounts = polymarketEqualSplitAmounts(remaining, remainingCost, realized);
  return amounts ? { ...base, ...amounts, pmRealizedPnlUsdc: realized, pmSellState: "settled" } : order;
}
