/** 同步与成交确认共用的成交读取；严格读取必须保留上游错误，不能伪装为无成交。 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { PolymarketTradeRow } from "../history/orderTradeTypes";
import { pmGetTrades } from "../pmClientApi";

const MAX_TRADE_PAGES = 5;

export async function readPolymarketTrades(
  account: PlatformAccount,
  afterSec: number,
  strict = false,
): Promise<PolymarketTradeRow[]> {
  try {
    const batch = await pmGetTrades<PolymarketTradeRow[]>(account, afterSec, MAX_TRADE_PAGES);
    if (strict && !Array.isArray(batch))
      throw new Error("PM 成交查询返回非列表响应");
    return Array.isArray(batch) ? batch : [];
  }
  catch (error) {
    if (strict)
      throw error;
    return [];
  }
}
