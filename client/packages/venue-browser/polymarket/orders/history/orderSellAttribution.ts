/** 官网买卖成交之间的份额归因；站内买卖保留已有绑定，不访问外部状态。 */
import { sortVenueOrdersNewestFirst, type VenueOrder } from "@changmen/client-core/contract";
import { resolvePmRemainingShares, resolveBuyStakeUsdc } from "../positions/pmLogicalPosition";
import { round4 } from "./orderTradeAmounts";

/** 同 token 卖单份额与买单剩余份额匹配容差 */
const PM_SELL_SHARE_MATCH_EPS = 0.05;

type PmReconcileBuy = VenueOrder & {
  _fillShares: number;
  _remainingShares: number;
  _remainingStake: number;
  /** 仅卖出已实现盈亏累加器；不含 0.99/Gamma 纸面 money */
  _realizedMoney: number;
  _realizedPnlUsdc: number;
};

/** 卖单 → 对应买单：changmen 用 persist 写入的 pmBuyOrderId；官网卖单按份额匹配 */
function findBuyForPolymarketSell(
  sell: VenueOrder,
  buys: PmReconcileBuy[],
  buyById: Map<string, PmReconcileBuy>,
): PmReconcileBuy | undefined {
  const sharesSold = Number(sell.pmShares) || 0;
  if (sharesSold <= 0)
    return undefined;

  if (sell.pmOrigin === "changmen" && sell.pmBuyOrderId) {
    const linked = buyById.get(sell.pmBuyOrderId);
    if (linked)
      return linked;
  }

  const token = String(sell.pmTokenId ?? "");
  const candidates = buys
    .filter(b => String(b.pmTokenId ?? "") === token && b._remainingShares > 0.0001)
    .sort((a, b) => a.createAt - b.createAt || a.orderId.localeCompare(b.orderId));

  if (!candidates.length)
    return undefined;

  const exact = candidates.find(b =>
    Math.abs(b._remainingShares - sharesSold) <= PM_SELL_SHARE_MATCH_EPS,
  );
  if (exact)
    return exact;

  return candidates.find(b => b._remainingShares + PM_SELL_SHARE_MATCH_EPS >= sharesSold)
    ?? candidates[0];
}

/** 卖单绑定买单并扣减买单份额；changmen 行不参与匹配（persist 已写 pmBuyOrderId） */
export function reconcilePolymarketBuySellOrders(orders: VenueOrder[]): VenueOrder[] {
  const changmen = orders.filter(o => o.pmOrigin === "changmen");
  const external = orders.filter(o => o.pmOrigin !== "changmen");
  if (!external.length)
    return sortVenueOrdersNewestFirst(changmen);
  const reconciled = reconcileExternalPolymarketOrders(external);
  return sortVenueOrdersNewestFirst([...changmen, ...reconciled]);
}

function reconcileExternalPolymarketOrders(orders: VenueOrder[]): VenueOrder[] {
  const buys: PmReconcileBuy[] = orders
    .filter(o => o.pmSide !== "sell")
    .map((o) => {
      const attr = Number(o.pmAttributedSellShares) || 0;
      const hasPriorSell = attr > 0.0001
        || o.pmSellState === "partial"
        || o.pmSellState === "closed";
      // 无卖出归因时 money 可能是 0.99/Gamma 纸面盈亏，不纳入卖出累加
      const realized = hasPriorSell ? (Number(o.money) || 0) : 0;
      const realizedPnl = hasPriorSell ? (Number(o.pmRealizedPnlUsdc) || 0) : 0;
      return {
        ...o,
        pmSide: o.pmSide ?? "buy" as const,
        _fillShares: Number(o.pmShares) || 0,
        _remainingShares: resolvePmRemainingShares(o),
        _remainingStake: resolveBuyStakeUsdc(o),
        _realizedMoney: realized,
        _realizedPnlUsdc: realizedPnl,
      };
    });
  const sellCopies = orders
    .filter(o => o.pmSide === "sell")
    .map(o => ({ ...o }))
    .sort((a, b) => a.createAt - b.createAt || a.orderId.localeCompare(b.orderId));

  const buyById = new Map(buys.map(b => [b.orderId, b]));

  for (const sell of sellCopies) {
    if (sell.pmOrigin !== "changmen")
      sell.pmBuyOrderId = undefined;

    const sharesSold = Number(sell.pmShares) || 0;
    const buy = findBuyForPolymarketSell(sell, buys, buyById);
    if (!buy || sharesSold <= 0)
      continue;

    if (sell.pmOrigin !== "changmen")
      sell.pmBuyOrderId = buy.orderId;

    const deduct = Math.min(sharesSold, buy._remainingShares);
    if (deduct <= 0)
      continue;

    const ratio = buy._remainingShares > 0 ? deduct / buy._remainingShares : 0;
    const costPortion = round4(buy._remainingStake * ratio);
    const sellPrice = Number(sell.odds) > 0 ? 1 / Number(sell.odds) : 0;
    const fromTradeUsdc = Number(sell.betMoney) > 0 ? Number(sell.betMoney) : 0;
    const proceedsUsdc = fromTradeUsdc > 0
      ? round4(fromTradeUsdc * (deduct / sharesSold))
      : round4(deduct * sellPrice);
    const profitUsdc = round4(proceedsUsdc - costPortion);

    sell.pmRealizedPnlUsdc = profitUsdc;
    // 已实现盈亏累加买单；卖单只保留回款
    sell.money = 0;
    sell.betMoney = proceedsUsdc;
    sell.pmStakeUsdc = costPortion;

    buy._realizedMoney = round4(buy._realizedMoney + profitUsdc);
    buy._realizedPnlUsdc = round4(buy._realizedPnlUsdc + profitUsdc);
    buy.money = buy._realizedMoney;
    buy.pmRealizedPnlUsdc = buy._realizedPnlUsdc;
    buy._remainingShares = round4(buy._remainingShares - deduct);
    buy._remainingStake = round4(buy._remainingStake - costPortion);
    buy.pmAttributedSellShares = round4((buy.pmAttributedSellShares ?? 0) + deduct);
    buy.pmSellState = buy._remainingShares <= 0.0001 ? "closed" : "partial";
  }

  const normalizedBuys = buys.map(({
    _remainingShares,
    _remainingStake,
    _fillShares,
    _realizedMoney,
    _realizedPnlUsdc,
    ...b
  }) => ({
    ...b,
    pmShares: round4(_fillShares),
    pmStakeUsdc: _remainingStake > 0 ? round4(_remainingStake) : 0,
  }));

  return sortVenueOrdersNewestFirst([...normalizedBuys, ...sellCopies]);
}
