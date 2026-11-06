/** 按原单关联 tradeId 精确补齐累计金额，避免账号时间窗及分页上限被当作全部成交。 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { PolymarketTradeRow } from "../history/orderTradeTypes";
import { pmGetOrder, pmGetTradesById } from "../pmClientApi";
import { polymarketOrderFillTradeIds, polymarketOrderFillTotals, type PolymarketFillOrderSnapshot } from "../facts/orderFillTotals";

export async function readPolymarketOrderFillAmounts(account: PlatformAccount, orderId: string, side: "BUY" | "SELL", minimumShares = 0) {
  const id = String(orderId ?? "").trim();
  if (!id) return null;
  try {
    const first = await pmGetOrder<PolymarketFillOrderSnapshot>(account, id);
    const ids = polymarketOrderFillTradeIds(first, id, side);
    if (!ids) return null;
    const batches: PolymarketTradeRow[][] = [];
    let next = 0;
    const results = await Promise.allSettled(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (next < ids.length) {
        const tradeId = ids[next++];
        const batch = await pmGetTradesById(account, tradeId);
        if (!Array.isArray(batch) || batch.some(row => String(row?.id ?? "").trim().toLowerCase() !== tradeId))
          throw new Error("PM 关联成交查询不完整");
        batches.push(batch as PolymarketTradeRow[]);
      }
    }));
    if (results.some(result => result.status === "rejected")) return null;
    // A changed order must be reconciled with its newer IDs/quantity on the next attempt.
    const latest = await pmGetOrder<PolymarketFillOrderSnapshot>(account, id);
    const latestIds = polymarketOrderFillTradeIds(latest, id, side);
    if (!latestIds || latestIds.length !== ids.length || latestIds.some(value => !ids.includes(value))
      || latest.asset_id !== first.asset_id || latest.market !== first.market
      || Number(latest.size_matched) !== Number(first.size_matched)) return null;
    return polymarketOrderFillTotals(latest, batches.flat(), id, side, minimumShares);
  }
  catch {
    // Unknown amounts remain unknown; the caller may retry the same original order.
    return null;
  }
}
