import type { PolymarketWsBidUpdate } from "../wsQuotes";

/** [changmen 扩展] 每条行情连接独立保存买一；不写入买入/套利使用的 fo。 */
export function createPmBidQuoteCache() {
  const bids = new Map<string, { price: number | null; timestamp?: number }>();
  const listeners = new Set<(assetId: string) => void>();
  const notify = (id: string) => {
    for (const fn of listeners) {
      try { fn(id); }
      catch (err) { console.warn("[Polymarket] bid quote listener", err); }
    }
  };
  return {
    get(assetId: string): number | null { return bids.get(assetId)?.price ?? null; },
    apply(update: PolymarketWsBidUpdate) {
      const previous = bids.get(update.assetId);
      if (previous?.timestamp && (!update.timestamp || update.timestamp < previous.timestamp)) return;
      bids.set(update.assetId, { price: update.bestBid, timestamp: update.timestamp });
      if (previous?.price !== update.bestBid) notify(update.assetId);
    },
    subscribe(fn: (assetId: string) => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    retain(assetIds: Set<string>) {
      for (const id of bids.keys()) {
        if (!assetIds.has(id)) { bids.delete(id); notify(id); }
      }
    },
    clear() {
      const ids = [...bids.keys()];
      bids.clear();
      for (const id of ids) notify(id);
    },
    reset() { this.clear(); listeners.clear(); },
  };
}
