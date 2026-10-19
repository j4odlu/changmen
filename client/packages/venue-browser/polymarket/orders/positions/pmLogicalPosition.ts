import type { VenueOrder, VenueOrderStatus } from "@changmen/client-core/contract";
import type { PolymarketSellState } from "@changmen/client-core/contract";
import { getExchange, Currency } from "@changmen/shared/currency";

export interface OrderRowLike {
  OrderID?: number | string;
  Type?: string;
  Match?: string;
  Bet?: string;
  Item?: string;
  Odds?: number;
  BetMoney?: number;
  Money?: number;
  Status?: string;
  CreateAt?: number;
  Link?: number;
  PmTokenId?: string;
  PmShares?: number;
  PmFillPrice?: number;
  PmStakeUsdc?: number;
  PmFeeUsdc?: number;
  PmConditionId?: string;
  PmOrigin?: "changmen" | "external";
  PmAttributedSellShares?: number;
  PmRealizedPnlUsdc?: number;
  PmSellProceeds?: number;
  PmLastSellOrderId?: string;
  PmSellState?: PolymarketSellState;
  PmSide?: "buy" | "sell";
  PmBuyOrderId?: string;
  /** 市场赛果（持有到期）：Win/Lose */
  PmMatchResult?: "Win" | "Lose" | "win" | "lose";
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 卖出/成交份数尘量：FOK 常按 2 位撮合，fill 可能多出 ~0.01 以内 */
export const PM_SHARE_DUST = 0.01;

/** 买单/API 成交总份数（pmShares 只存官方 fill，不随平仓扣减） */
export function resolvePmFillShares(order: OrderRowLike | VenueOrder): number {
  const row = order as OrderRowLike;
  const venue = order as VenueOrder;
  return Number(row.PmShares ?? venue.pmShares) || 0;
}

/** 买单剩余可卖份数 = fill − 已归因卖出；尘量视为 0 */
export function resolvePmRemainingShares(order: OrderRowLike | VenueOrder): number {
  const fill = resolvePmFillShares(order);
  const attributed = Number(
    (order as OrderRowLike).PmAttributedSellShares
    ?? (order as VenueOrder).pmAttributedSellShares,
  ) || 0;
  const rem = round4(Math.max(0, fill - attributed));
  return rem <= PM_SHARE_DUST ? 0 : rem;
}

/** 买单成本（USDC）：剩余敞口用 pmStakeUsdc；无剩余仓时不得回落原始 BetMoney */
export function resolveBuyStakeUsdc(buy: VenueOrder | OrderRowLike): number {
  const venue = buy as VenueOrder;
  const row = buy as OrderRowLike;
  const remaining = resolvePmRemainingShares(buy);
  const state = String(row.PmSellState ?? venue.pmSellState ?? "").toLowerCase();
  if (state === "closed" || remaining <= 0)
    return 0;
  const stakeUsdc = Number(venue.pmStakeUsdc ?? row.PmStakeUsdc);
  if (Number.isFinite(stakeUsdc) && stakeUsdc > 0)
    return round4(stakeUsdc);
  // 仅未卖/无 stake 字段时，用 BetMoney 作满仓成本兜底
  if (state === "partial" || (Number(row.PmAttributedSellShares ?? venue.pmAttributedSellShares) || 0) > 0)
    return 0;
  const betDisplay = Number(venue.betMoney ?? row.BetMoney) || 0;
  if (betDisplay > 0)
    return round4(betDisplay / getExchange(Currency.USDT));
  return 0;
}

function statusFromRow(status?: string): VenueOrderStatus {
  const s = String(status ?? "").toLowerCase();
  if (s === "win")
    return "win";
  if (s === "lose")
    return "lose";
  if (s === "reject")
    return "reject";
  if (s === "return")
    return "return";
  if (s === "pending")
    return "pending";
  return "none";
}

function resolvePmSide(row: OrderRowLike): "buy" | "sell" {
  if (row.PmSide === "sell")
    return "sell";
  return "buy";
}

/** 订单侧栏行 → VenueOrder */
export function venueOrderFromOrderRow(row: OrderRowLike): VenueOrder {
  const betMoney = Number(row.BetMoney) || 0;
  const odds = Number(row.Odds) || 0;
  const pmSide = resolvePmSide(row);
  return {
    provider: "Polymarket",
    orderId: String(row.OrderID ?? "").trim(),
    odds,
    createAt: Number(row.CreateAt) || Date.now(),
    betMoney,
    reward: round4(betMoney * odds),
    money: Number(row.Money) || 0,
    status: statusFromRow(row.Status),
    game: "",
    match: String(row.Match ?? ""),
    bet: String(row.Bet ?? ""),
    item: String(row.Item ?? ""),
    link: Number(row.Link) || undefined,
    pmTokenId: row.PmTokenId,
    pmShares: row.PmShares,
    pmFillPrice: row.PmFillPrice,
    pmStakeUsdc: row.PmStakeUsdc,
    pmFeeUsdc: row.PmFeeUsdc,
    pmConditionId: row.PmConditionId,
    pmOrigin: row.PmOrigin,
    pmAttributedSellShares: row.PmAttributedSellShares,
    pmRealizedPnlUsdc: row.PmRealizedPnlUsdc,
    pmSellProceeds: row.PmSellProceeds,
    pmLastSellOrderId: row.PmLastSellOrderId,
    pmSellState: row.PmSellState ?? (pmSide === "buy" ? "open" : undefined),
    pmSide,
    pmBuyOrderId: row.PmBuyOrderId,
    pmMatchResult: (() => {
      const m = String(row.PmMatchResult ?? "").trim().toLowerCase();
      return m === "win" || m === "lose" ? m : undefined;
    })(),
  };
}

export function isPolymarketSellOrder(order: OrderRowLike | VenueOrder): boolean {
  const rowLike = order as OrderRowLike;
  const venueLike = order as VenueOrder;
  return rowLike.PmSide === "sell" || venueLike.pmSide === "sell";
}

/**
 * 同步时剥离官网/external 卖单；保留 changmen 手动卖单（同 Link 展示）。
 * CLOB trade 映射的 sell 默认为 external，避免与买单双计。
 */
export function stripPolymarketSellOrders<T extends OrderRowLike | VenueOrder>(orders: T[]): T[] {
  return orders.filter((o) => {
    if (!isPolymarketSellOrder(o))
      return true;
    const row = o as OrderRowLike;
    const venue = o as VenueOrder;
    const origin = row.PmOrigin ?? venue.pmOrigin;
    return origin === "changmen";
  });
}

export function hasChangmenLogicalSell(order: VenueOrder): boolean {
  return order.pmSide === "sell"
    || (order.pmOrigin === "changmen"
      && ((order.pmAttributedSellShares ?? 0) > 0
        || order.pmSellState === "partial"
        || order.pmSellState === "closed"));
}

/** 仍有未平仓份额；卖单永远不算持仓 */
export function hasOpenPolymarketPosition(order: OrderRowLike | VenueOrder): boolean {
  if (isPolymarketSellOrder(order))
    return false;

  const rowLike = order as OrderRowLike;
  const venueLike = order as VenueOrder;
  const status = String(rowLike.Status ?? venueLike.status ?? "").toLowerCase();
  // reject/return/pending 不可卖；win/lose 若仅 0.99 启发式（未 official settled）仍可卖
  if (status === "reject" || status === "return" || status === "pending")
    return false;

  const state = rowLike.PmSellState ?? venueLike.pmSellState;
  // official winner → settled，隐藏卖出；手动卖光 → closed
  if (state === "closed" || state === "settled")
    return false;

  const fill = resolvePmFillShares(order);
  // 无成交份数：不算可卖持仓（避免 pmShares≈0 仍显示「卖出」）
  if (fill <= 0.0001)
    return false;

  return resolvePmRemainingShares(order) > 0.0001;
}
