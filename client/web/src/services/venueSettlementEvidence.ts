import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { VenueOrder } from "@changmen/venue-adapter/contract";

/** [changmen 扩展] RAY 无提交订单号时，按场馆身份、时间、金额和赔率唯一关联；不改业务判定或绑定。 */
export function settlementEvidenceOrder(option: BetOption, result: BetResult, orders: readonly VenueOrder[]): VenueOrder | undefined {
  if (result.orderId)
    return orders.find(order => String(order.orderId) === String(result.orderId));
  if (result.provider !== "RAY" || !Number.isFinite(result.beginTime) || !result.beginTime)
    return undefined;
  const matches = orders.filter(order => order.provider === "RAY" && Boolean(order.orderId)
    && order.venueMatchId === String(option.matchId) && order.venueItemId === String(option.itemId)
    && order.createAt >= result.beginTime - 10_000 && order.createAt <= result.beginTime + 120_000
    && Math.abs(order.betMoney - Math.round(option.betMoney)) < 0.01
    && Math.abs(order.odds - (option.newOdds || option.odds)) < 0.001);
  // A8 检测取首条；只有同一首条唯一匹配本次提交，才把检测结果关联成场馆证据。
  return matches.length === 1 && matches[0] === orders[0] ? matches[0] : undefined;
}

/** [changmen 扩展] 从提交结果读取阶段身份，避免 settle 修改 pending 后丢失 delayed 身份。 */
export function submissionVenueStatus(result: BetResult): string | undefined {
  if (result.provider !== "Polymarket")
    return undefined;
  const response = result.response && typeof result.response === "object" ? result.response as Record<string, unknown> : undefined;
  const status = typeof response?.status === "string" ? response.status.trim().toLowerCase() : "";
  if (status === "delayed" || result.pending)
    return "delayed";
  return result.success && status === "matched" ? "matched" : undefined;
}
