import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import { buildPolymarketMatchedBuyVenueOrderFromBet } from "@changmen/venue-browser/adapter/polymarket";
import { saveOrders } from "@/api/order";

/**
 * [changmen 扩展] PM FOK matched：用 POST 成交金额立刻 saveOrders，
 * 侧栏不依赖 `/data/trades` 索引（官方 Place Order 语义）。
 * delayed / 非 PM / 解析失败返回 null，不影响下单成功。
 */
export async function persistPolymarketMatchedBuyOrder(
  account: PlatformAccount,
  option: BetOption,
  result: BetResult,
): Promise<VenueOrder | null> {
  if (String(account.provider ?? "") !== "Polymarket")
    return null;
  const order = await buildPolymarketMatchedBuyVenueOrderFromBet(option, result);
  if (!order)
    return null;
  await saveOrders(account, [order]);
  return order;
}
