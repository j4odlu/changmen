import type { OrderRow } from "@/types/order";
import type { GtcOrderRecord } from "./core/orderRecord";
import { gtcOrderNeverSubmitted } from "@changmen/shared/pm_gtc_order";
import { filterOrdersBelongingToDate } from "@/shared/orderLink";
import { isFootballOrderRow } from "@/shared/orderDomain";
import { gtcOrderCardView } from "./orderCardView";
import { gtcMatchedOrder } from "./financialOrder";
import { gtcOrderItemText } from "./orderItem";

export function isNativeGtcBuy(row: OrderRow, order: GtcOrderRecord): boolean {
  return row.Type === "Polymarket" && row.PmSide !== "sell" && row.PlayerID === order.accountId
    && [order.orderId, order.plan.orderHash, `gtc-pending:${order.id}`].some(id => id && id.toLowerCase() === String(row.OrderID).toLowerCase());
}
export function nativeGtcPendingRows(financial: OrderRow[], orders: GtcOrderRecord[], date: string, accountId: number): OrderRow[] {
  return orders.filter(order => (!accountId || order.accountId === accountId) && !gtcOrderNeverSubmitted(order)
    && !financial.some(row => isNativeGtcBuy(row, order))
    && filterOrdersBelongingToDate([{ CreateAt: order.createdAt, Link: order.context.linkId }], date).length).map(order => {
    const view = gtcOrderCardView(order);
    const matched = Number(order.matched);
    const display = view.quantitiesAgree && matched > 0 ? gtcMatchedOrder(order, Number(view.fee ?? 0)) : null;
    return { OrderID: order.orderId ?? `gtc-pending:${order.id}`, DisplayOnly: true, PmGtcExecutionId: order.id,
      Type: "Polymarket", PlayerID: order.accountId, PmOrderType: "GTC", PmSide: "buy", PmOrigin: "changmen", PmTokenId: order.plan.tokenId, PmConditionId: order.plan.conditionId,
      Link: order.context.linkId, Match: order.context.match, Bet: order.context.bet, Item: gtcOrderItemText(order.context.item, order.context.match), CreateAt: order.createdAt,
      Status: order.submit === "rejected" ? "Reject" : order.terminal && order.complete && !order.error && matched === 0 ? "Return" : "None",
      ...(view.quantitiesAgree ? { PmShares: matched } : {}),
      ...(display ? { PmFillPrice: display.pmFillPrice, Odds: display.odds,
          ...(view.fee != null ? { PmStakeUsdc: display.pmStakeUsdc, PmFeeUsdc: display.pmFeeUsdc, BetMoney: display.betMoney } : {}) }
        : view.quantitiesAgree && matched === 0 ? { PmStakeUsdc: 0, PmFeeUsdc: 0, BetMoney: 0 } : {}),
    } as OrderRow;
  }).filter(row => !isFootballOrderRow(row));
}
