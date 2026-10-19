import { getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import { PLATFORMS } from "@changmen/client-core/shared/platforms";

/** [changmen 扩展] 仅优化 FOK：更新的卖一可否定旧簿，但不能用卖一证明足额深度。 */
export function optimizedFokQuoteBlock(tokenId: string, limitPrice: number, bookFetchedAt: number): string | null {
  const quote = getVenueOddsEntry(PLATFORMS.Polymarket, tokenId);
  if (!quote) return null;
  // 锁盘推送只修改 isLock，不刷新报价 time；不能用价格时间戳豁免已知锁盘。
  if (quote.isLock) return "PM 当前盘口已锁定，请新建投注尝试";
  if (!Number.isFinite(Number(quote.time)) || Number(quote.time) <= bookFetchedAt) return null;
  const ask = Number(quote.clobPrice);
  if (Number.isFinite(ask) && ask > 0 && ask < 1 && ask > limitPrice + 1e-9)
    return "PM 最新卖价已超过本轮限价，无法按本轮盘口成交";
  return null;
}
