/** 订单在展示/保存阶段执行一次 USDC 到 CNY 转换；不读取或同步订单。 */
import type { VenueOrder } from "@changmen/client-core/contract";
import { scaleUsdtToCnyDisplay } from "@changmen/shared/currency";

/** CLOB 口径 USDC → 侧栏/DB CNY 展示（整条链路只 scale 一次） */
export function scalePolymarketVenueOrdersForDisplay(orders: VenueOrder[]): VenueOrder[] {
  return orders.map(order => ({
    ...order,
    betMoney: scaleUsdtToCnyDisplay(order.betMoney),
    reward: scaleUsdtToCnyDisplay(order.reward),
    money: scaleUsdtToCnyDisplay(order.money),
  }));
}
