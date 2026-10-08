import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { OrderRow } from "@/types/order";

const SETTLED: Record<string, string> = { win: "已结算 · 赢", lose: "已结算 · 输", draw: "已结算 · 和", void: "已结算 · 作废" };

/** [changmen 扩展] delayed 后只展示本次提交订单的确认状态；不参与下注或补单判定。 */
export function pmOrderConfirmation(events: readonly OrderObservationEvent[], orders: readonly OrderRow[] = []) {
  const submit = [...events].reverse().find(event => event.kind === "submission_result");
  if (submit?.provider !== "Polymarket" || !(submit.observedStatus === "delayed" || submit.outcome === "unknown"))
    return undefined;
  // 当前订单列表随刷新更新；None 只有带正数成交份额才证明成交，绑定占位行不算证据。
  const records = orders.filter(order => submit.orderId && submit.accountId !== undefined
    && String(order.OrderID) === submit.orderId && order.Type === "Polymarket"
    && order.PlayerID === submit.accountId && order.Link === submit.linkId && order.PmSide !== "sell"
    && Number.isFinite(order.PmShares) && Number(order.PmShares) > 0
    && ["none", "win", "lose", "draw", "void"].includes(String(order.Status).toLowerCase()));
  const matching = events.filter(event => event.kind === "settlement_observed"
    && Boolean(submit.orderId) && event.orderId === submit.orderId && event.provider === "Polymarket"
    && (submit.accountId === undefined || event.accountId === submit.accountId));
  const venue = matching.filter(event => ["adapter", "order_record"].includes(event.source || ""));
  const status = (event: OrderObservationEvent) => event.observedStatus?.trim().toLowerCase();
  const fills = venue.filter(event => event.outcome === "filled" && ["none", "matched", "mined", "confirmed", "win", "lose", "draw", "void"].includes(status(event) || ""));
  const rejects = venue.filter(event => event.outcome === "unfilled" && ["reject", "canceled", "cancelled", "expired"].includes(status(event) || ""));
  const terminal = [...fills, ...rejects];
  const confirmed = [...venue].reverse().find(event => terminal.includes(event));
  const policy = [...matching].reverse().find(event => event.source === "timeout_policy");
  const evidence = confirmed || policy || venue.at(-1);
  const rawStatus = evidence?.observedStatus;
  const detail = submit.orderId
    ? `PM 订单 ${submit.orderId}${rawStatus ? ` · 订单状态 ${rawStatus}` : " · 尚无明确订单状态"}`
    : "本次提交未记录 PM 订单号，无法关联订单状态";
  if (fills.length && rejects.length)
    return { label: "订单确认记录冲突", tone: "warning" as const, basis: detail, event: evidence };
  if (records.length === 1) {
    const record = records[0]!;
    const state = String(record.Status).toLowerCase();
    if (rejects.length)
      return { label: "订单确认记录冲突", tone: "warning" as const, basis: `${detail} · 当前订单记录另有成交份额`, event: evidence };
    // 列表可能滞后；已结算回执不能被旧 None 状态降回未结算。
    if (state !== "none" || !SETTLED[confirmed ? status(confirmed) || "" : ""])
      return { label: state === "none" ? "订单已成交 · 未结算" : SETTLED[state]!, tone: "success" as const,
        basis: `PM 订单 ${submit.orderId} · 当前订单状态 ${record.Status} · 成交份额 ${record.PmShares}（状态更新时间未提供）`, event: undefined };
  }
  if (confirmed) {
    const state = status(confirmed)!;
    return {
      label: confirmed.outcome === "unfilled" ? state === "reject" ? "订单未成交 · 拒单" : state === "expired" ? "订单未成交 · 已过期" : "订单未成交 · 已取消"
        : state === "none" ? "订单已成交 · 未结算" : SETTLED[state] || "订单已成交",
      tone: confirmed.outcome === "unfilled" ? "danger" as const : "success" as const,
      basis: detail, event: confirmed,
    };
  }
  if (policy)
    return { label: "超时策略处理", tone: "warning" as const, basis: `${detail} · 本地超时处理，不代表场馆取消或拒单`, event: policy };
  return { label: "订单待确认", tone: "pending" as const, basis: detail, event: evidence || submit };
}
