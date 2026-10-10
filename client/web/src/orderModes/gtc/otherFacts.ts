import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
/** 原单 id 优先；缺 id 时只接纳唯一的场馆比赛/选项/金额/时间完全绑定候选。 */
export function findGtcOtherOrder(row: GtcExecution, orders: readonly VenueOrder[]): VenueOrder | undefined {
  const candidates = orders.filter((order) => {
    if (order.provider !== row.plan.otherProvider)
      return false;
    if (row.other.orderId)
      return order.orderId === row.other.orderId;
    // 提交未知不等于已受理；相同盘口/金额的 FOK 不能证明未知 GTC 的身份。
    if (!["accepted", "pending", "filled"].includes(row.other.state))
      return false;
    // 已绑定其它 changmen 执行的订单不是待猜测的 GTC 原单，禁止改绑 FOK。
    const link = Number(order.link);
    if (Number.isFinite(link) && Math.abs(link) >= 1_000_000_000_000 && link !== row.plan.linkId)
      return false;
    return Boolean(row.plan.otherVenueMatchId && row.plan.otherVenueItemId)
      && order.venueMatchId === row.plan.otherVenueMatchId && order.venueItemId === row.plan.otherVenueItemId
      && Math.abs(order.betMoney - row.plan.otherStake) < 0.01
      && order.createAt >= row.other.submittedAt - 1000 && order.createAt <= row.other.submittedAt + 120000;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
