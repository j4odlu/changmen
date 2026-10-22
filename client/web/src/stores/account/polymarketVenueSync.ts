/**
 * Polymarket RDS 订单加载器注册（须在 sessionBoot 前 import）。
 * 对齐 A8：updateOrders → provider.getOrders → saveOrders；PM 在 getOrders 内合并 RDS。
 *
 * [changmen 扩展] 不拉全历史 + 不拉 money logs：
 * 窗口对齐 PM_ORDER_FULL_LOOKBACK_MS（3 天），后端额外保留未结/未 settled 买单。
 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { isPmPendingOrder } from "@changmen/shared/pm_submission";
import { getPlayerOrder } from "@/api/chat";
import {
  PM_ORDER_FULL_LOOKBACK_MS,
  registerPolymarketStoredVenueOrdersLoader,
  stripPolymarketSellOrders,
  venueOrderFromOrderRow,
} from "@changmen/venue-browser/adapter/polymarket";

async function loadStoredPmVenueOrders(account: PlatformAccount) {
  const sinceCreateAt = Date.now() - PM_ORDER_FULL_LOOKBACK_MS;
  const info = await getPlayerOrder({
    playerId: account.accountId,
    sinceCreateAt,
    includeLogs: false,
  });
  return stripPolymarketSellOrders(
    (info.orders ?? [])
      .filter(o => String(o.Type ?? "") === "Polymarket" && !isPmPendingOrder(o))
      .map(o => venueOrderFromOrderRow(o)),
  );
}

registerPolymarketStoredVenueOrdersLoader(loadStoredPmVenueOrders);
