import { readPolymarketDisplayFeeDetails, type PolymarketMarketFeeDetails } from "@changmen/venue-browser/polymarket/orders/pmFee";

/** [changmen 扩展] UI 专用缓存；不共享交易侧费率回退、行情或报价状态。两侧及重复卡片合并同盘口请求。 */
export function createPmDisplayFeeLoader(
  read = readPolymarketDisplayFeeDetails,
  now = Date.now,
) {
  const cache = new Map<string, { details: PolymarketMarketFeeDetails | undefined; expiresAt: number }>();
  const pending = new Map<string, Promise<PolymarketMarketFeeDetails | undefined>>();
  let active = 0;
  const queue: (() => void)[] = [];
  const readQueued = (id: string) => new Promise<PolymarketMarketFeeDetails | undefined>(resolve => {
    queue.push(() => {
      active++;
      void Promise.resolve().then(() => read(id)).catch(() => undefined).then(resolve).finally(() => {
        active--;
        queue.shift()?.();
      });
    });
    if (active < 4) queue.shift()?.();
  });
  return (conditionId: string): Promise<PolymarketMarketFeeDetails | undefined> => {
    const id = conditionId.trim();
    if (!id) return Promise.resolve(undefined);
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now()) return Promise.resolve(hit.details);
    const inFlight = pending.get(id);
    if (inFlight) return inFlight;
    const request = readQueued(id).then(details => {
      cache.delete(id);
      cache.set(id, { details, expiresAt: now() + (details ? 5 * 60_000 : 30_000) });
      while (cache.size > 512) cache.delete(cache.keys().next().value!);
      return details;
    }).finally(() => pending.delete(id));
    pending.set(id, request);
    return request;
  };
}

export const loadPmDisplayFee = createPmDisplayFeeLoader();
