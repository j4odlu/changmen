/** 将单笔已汇总成交转换为订单快照；金额为 USDC，来源标记与卖出归因由同步入口负责。 */
import type { VenueOrder } from "@changmen/client-core/contract";
import { PLATFORMS } from "@changmen/client-core/shared/platforms";
import { polymarketOrderContextFromMarket, type PolymarketRawMarket } from "../../markets/parse";
import type { PolymarketTradeRow } from "./orderTradeTypes";
import { polymarketBuyStakeUsdc, polymarketShareCount, round4 } from "./orderTradeAmounts";
import { applyPolymarketSettlement, tradeHeldAssetId } from "./orderMarketSettlement";

export function mapPolymarketTradeToVenueOrder(
  trade: PolymarketTradeRow,
  market?: PolymarketRawMarket,
): VenueOrder | null {
  const orderId = String(trade.taker_order_id ?? trade.id ?? "").trim();
  if (!orderId) return null;

  const price = Number(trade.price);
  const sizeRaw = trade.size;
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return null;

  const betMoney = Math.round(polymarketBuyStakeUsdc(sizeRaw, price) * 10000) / 10000;
  if (betMoney <= 0) return null;

  const odds = Math.round((1 / price) * 10000) / 10000;
  const shares = polymarketShareCount(sizeRaw);
  if (shares <= 0)
    return null;
  const pmTokenId = tradeHeldAssetId(trade, market);
  const ctx = market
    ? polymarketOrderContextFromMarket(market)
    : { game: "", match: "", bet: "" };
  const marketId = String(trade.market ?? "").trim();
  const match = ctx.match || (marketId ? `${marketId.slice(0, 10)}…` : "");

  const unsettled: VenueOrder = {
    provider: PLATFORMS.Polymarket,
    orderId,
    odds,
    createAt: (Number(trade.match_time) || 0) * 1000,
    betMoney,
    reward: Math.round(betMoney * odds * 10000) / 10000,
    money: 0,
    status: "none",
    game: ctx.game,
    match,
    bet: ctx.bet,
    item: String(trade.outcome ?? "").trim(),
    pmTokenId: pmTokenId || undefined,
    pmShares: shares,
    pmFillPrice: price,
    pmStakeUsdc: betMoney,
    pmConditionId: marketId || undefined,
    pmSide: "buy",
    pmSellState: "open",
  };
  return applyPolymarketSettlement(unsettled, trade, market);
}

/** SELL 成交 → 独立卖单（盈亏由 reconcilePolymarketBuySellOrders 填） */
export function mapPolymarketSellTradeToVenueOrder(
  trade: PolymarketTradeRow,
  market?: PolymarketRawMarket,
): VenueOrder | null {
  const orderId = String(trade.taker_order_id ?? trade.id ?? "").trim();
  if (!orderId)
    return null;

  const price = Number(trade.price);
  const sizeRaw = trade.size;
  if (!Number.isFinite(price) || price <= 0 || price >= 1)
    return null;

  const shares = polymarketShareCount(sizeRaw);
  if (shares <= 0)
    return null;

  const odds = Math.round((1 / price) * 10000) / 10000;
  const proceedsUsdc = round4(polymarketBuyStakeUsdc(sizeRaw, price));
  const pmTokenId = tradeHeldAssetId(trade, market);
  const ctx = market
    ? polymarketOrderContextFromMarket(market)
    : { game: "", match: "", bet: "" };
  const marketId = String(trade.market ?? "").trim();
  const match = ctx.match || (marketId ? `${marketId.slice(0, 10)}…` : "");
  const item = String(trade.outcome ?? "").trim();

  return {
    provider: PLATFORMS.Polymarket,
    orderId,
    odds,
    createAt: (Number(trade.match_time) || 0) * 1000,
    betMoney: proceedsUsdc,
    reward: 0,
    money: 0,
    status: "none",
    game: ctx.game,
    match,
    bet: ctx.bet,
    item: item ? `平仓 ${item}` : "平仓",
    pmTokenId: pmTokenId || undefined,
    pmShares: shares,
    pmFillPrice: price,
    pmStakeUsdc: 0,
    pmConditionId: marketId || undefined,
    pmSide: "sell",
    pmOrigin: "external",
  };
}
