import type { GtcOrderRecord } from "./core/orderRecord";
import type { BetNotice } from "@/shared/betNotification";
import { gtcOrderCardView } from "./orderCardView";

/** 单笔订单结果提示，不包含配对完成或另一腿的状态。 */
export function presentGtcOrder(row: GtcOrderRecord) {
  const view = gtcOrderCardView(row);
  const submission = view.unsubmitted ? "not_attempted" : row.submit === "dispatching" || row.submit === "prepared" ? "in_flight" : row.submit;
  const fill = !row.complete || row.error ? "unknown" : Number(row.matched) === 0 ? "none" : Number(row.matched) >= Number(row.plan.shares) ? "full" : "partial";
  const detail = row.submit === "accepted" && view.quantitiesAgree && !row.terminal
    ? Number(row.matched) > 0 ? "部分成交挂单中" : "未成交挂单中" : view.state;
  const message = `PM GTC：${detail}；成交 ${row.matched}/${row.plan.shares} 份；挂单 ${row.open ?? "待核实"} 份`;
  return { executionId: row.id, pm: { orderType: "GTC" as const, orderId: row.orderId, submission, fill,
    matchedShares: row.matched, remainingShares: row.open }, message, errorMessage: row.error };
}
export function nativeGtcNotice(row: GtcOrderRecord): BetNotice {
  const result = presentGtcOrder(row);
  return { type: result.pm.submission === "rejected" ? "error" : result.pm.submission === "accepted" && result.pm.fill === "full" ? "success" : "warning",
    message: `${result.message}${result.errorMessage ? `；${result.errorMessage}` : ""}` };
}
