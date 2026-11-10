import type { LoseOrder } from "@/models/loseOrder";

/** [changmen 扩展] 显示当前补单任务；纯原单续查不属于补单，等待赔率或账号仍属于补单。 */
export function visibleMakeupOrders(orders: ReadonlyMap<number, LoseOrder>, enabled: boolean): Map<number, LoseOrder> {
  return enabled
    ? new Map([...orders].filter(([, order]) => order.pendingVenueMakeUpEligible !== false))
    : new Map();
}
