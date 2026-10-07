import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { OrderRow } from "@/types/order";

/** [changmen 扩展] 旧检测事件缺订单号时，以同尝试的成功绑定和当前订单拒单状态补充只读展示。 */
export function withBoundRayOrderEvidence(events: readonly OrderObservationEvent[], orders: readonly OrderRow[]): OrderObservationEvent[] {
  return events.map(event => {
    if (event.provider !== "RAY" || event.kind !== "settlement_observed" || event.source !== "orchestration_result"
      || event.outcome !== "unfilled" || !event.attemptId || !event.accountId)
      return event;
    const bindings = events.filter(bind => bind.kind === "bind_result" && bind.outcome === "saved" && bind.orderId
      && bind.source !== "ray_bind_api_ack"
      && bind.ownerUserId === event.ownerUserId && bind.attemptId === event.attemptId
      && bind.linkId === event.linkId && bind.provider === "RAY" && bind.accountId === event.accountId);
    const ids = new Set(bindings.map(bind => bind.orderId));
    if (ids.size !== 1)
      return event;
    const orderId = [...ids][0]!;
    if (event.orderId && event.orderId !== orderId)
      return event;
    const matches = orders.filter(order => String(order.OrderID) === orderId && order.Type === "RAY"
      && order.Link === event.linkId && order.PlayerID === event.accountId);
    if (matches.length !== 1 || matches[0]?.Status !== "Reject")
      return event;
    return { ...event, source: "order_record", orderId, observedStatus: "reject", phase: "reject_detection" };
  });
}
