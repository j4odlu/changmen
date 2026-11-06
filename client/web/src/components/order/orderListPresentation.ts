import type { OrderRow } from "@/types/order";
import { isPmPendingOrder } from "@changmen/shared/pm_submission";
import { resolvePmRemainingShares } from "@changmen/venue-browser/polymarket";
import { isPmManuallySoldBuy, isPmSellOrderListRow } from "@/shared/pmOrderDisplay";
import { resolveOrderItemLabel } from "@/shared/orderItemDisplay";
import { isMakeupPendingOrderRow, isMakeupCancelledOrderRow } from "@/shared/orderLink";

export function orderItemText(row: OrderRow): string {
  return resolveOrderItemLabel(row.Item, row.Match);
}


export function isPendingRow(row: OrderRow): boolean {
  if (isMakeupPendingOrderRow(row) || isMakeupCancelledOrderRow(row))
    return false;
  // PF：已 1:1 卖出 / 赛果结算 / 卖单行不算「待结算」（对齐 PM）
  if (String(row.Type ?? "") === "PredictFun") {
    if (row.PfSide === "sell" || row.PfSellState === "closed" || row.PfSellState === "settled")
      return false;
  }
  // PM：卖单 / 已全卖买单不算「待结算」（角标已映 Win/Lose）
  if (String(row.Type ?? "") === "Polymarket") {
    if (row.PmSide === "sell")
      return false;
    if (isPmManuallySoldBuy(row)) {
      const state = String(row.PmSellState ?? "").toLowerCase();
      if (!(state === "partial" && resolvePmRemainingShares(row) > 0))
        return false;
    }
  }
  return String(row.Status ?? "") === "None";
}


export function pmStakeLabel(row: OrderRow): string {
  return isPmPendingOrder(row) ? "申请金额" : isPmSellOrderListRow(row) ? "回款" : "买入金额";
}
