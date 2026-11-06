/** 读取当前账号成交并按原单、买卖方向和确认状态选取证据；不触发订单同步或市场结算。 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { PolymarketTradeRow } from "../history/orderTradeTypes";
import { collectPolymarketUserAddressesFromAccount } from "../../auth/l2Auth";
import { flattenPolymarketTrades, polymarketTradeRefsOrderId, isPolymarketTradeConfirmed } from "../history/orderTradeProcessing";
import { polymarketFailedBuyTradeRow } from "../facts/tradeFailure";
import { readPolymarketTrades } from "../facts/tradeReader";

/** 近窗内按 orderId 查成交；拒单核验可显式启用唯一 BUY taker trade 的 FAILED 证据。 */
export async function fetchPolymarketConfirmedTradeForOrder(
  account: PlatformAccount,
  orderId: string,
  lookbackMs = 10 * 60 * 1000,
  side: "BUY" | "SELL" = "BUY",
  strict = false,
  includeFailedBuy = false,
): Promise<PolymarketTradeRow | null> {
  const id = String(orderId ?? "").trim();
  if (!id)
    return null;
  const afterSec = Math.floor((Date.now() - lookbackMs) / 1000);
  const userAddresses = collectPolymarketUserAddressesFromAccount(account);
  let rawTrades: PolymarketTradeRow[];
  try {
    rawTrades = await readPolymarketTrades(account, afterSec, strict);
  }
  catch (error) {
    if (strict)
      throw error;
    return null;
  }
  const flattened = flattenPolymarketTrades(rawTrades, userAddresses);
  const wantSide = side.toUpperCase();
  if (includeFailedBuy && wantSide === "BUY") {
    // 唯一性按原始 tradeId 核对，maker_orders 多条并不等于多笔 trade。
    const related = rawTrades.filter(trade => polymarketTradeRefsOrderId(trade, id));
    const ids = related.map(trade => String(trade.id ?? "").trim());
    if (ids.every(Boolean) && !related.some(trade => /^(TRADE_STATUS_)?CONFIRMED$/i.test(String(trade.status ?? "").trim()))) {
      const failed = related.find(trade => polymarketFailedBuyTradeRow(trade, id, ids));
      if (failed)
        return failed;
    }
  }
  for (const trade of flattened) {
    if (!polymarketTradeRefsOrderId(trade, id))
      continue;
    if (String(trade.side ?? "").trim().toUpperCase() !== wantSide)
      continue;
    if (!isPolymarketTradeConfirmed(String(trade.status ?? "")))
      continue;
    return trade;
  }
  return null;
}
