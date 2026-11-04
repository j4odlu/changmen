import { onPolymarketMarketQuote } from "@changmen/venue-browser/polymarket";
import { PriceHistory } from "./history";

interface Quote { assetId: string; bestAsk: number }
type Notify = () => void;

/** [changmen 扩展] 旁路消费已有行情事件；不注册资产、不启停连接、不写赔率或业务 store。 */
export function createPriceTrendRuntime(subscribe: (receive: (quote: Quote) => void) => () => void) {
  const assets = new Map<string, { users: number; history: PriceHistory }>();
  const observers = new Set<Notify>();
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    observe(assetIds: readonly string[], notify: Notify): () => void {
      const ids = [...new Set(assetIds.filter(Boolean))];
      if (!ids.length) return () => {};
      for (const id of ids) {
        const entry = assets.get(id) ?? { users: 0, history: new PriceHistory() };
        entry.users++;
        assets.set(id, entry);
      }
      // 每次 observe 独立持有回调，重复挂载同一函数也能正确释放。
      const callback = () => notify();
      observers.add(callback);
      if (!unsubscribe) {
        unsubscribe = subscribe(quote => assets.get(quote.assetId)?.history.push(quote.bestAsk, Date.now()));
        timer = setInterval(() => {
          for (const observer of observers) observer();
        }, 1_000);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        observers.delete(callback);
        for (const id of ids) {
          const entry = assets.get(id);
          if (entry && --entry.users === 0) assets.delete(id);
        }
        if (!observers.size) {
          unsubscribe?.(); unsubscribe = undefined;
          clearInterval(timer); timer = undefined;
        }
      };
    },
    read(assetId: string, now: number) {
      return assets.get(assetId)?.history.read(now) ?? [];
    },
  };
}

export const priceTrendRuntime = createPriceTrendRuntime(receive => onPolymarketMarketQuote(receive));
