import type { PolymarketRawMarket } from "../../markets/parse";

type MarketMap = Map<string, PolymarketRawMarket>;
type LoadMarkets = (conditions: string[], tokens: string[]) => Promise<MarketMap>;
export interface StoredMarketRef { conditionId?: string; tokenId?: string }
interface Entry {
  key: string;
  condition: string;
  tokens: Set<string>;
  value: MarketMap;
  retryAt: number;
  pending: boolean;
  load: LoadMarkets;
}

/** [changmen 扩展] 只缓存公开盘口事实；历史补查不持有账号、订单或下注许可。 */
export function createStoredMarketRefresh({ now = Date.now, refreshMs = 30_000, retryMs = 5_000,
  maxEntries = 512, batchSize = 20, concurrency = 2 } = {}) {
  const entries = new Map<string, Entry>();
  const queue: Entry[] = [];
  let running = 0;

  function drain(): void {
    while (running < concurrency && queue.length) {
      const batch = queue.splice(0, batchSize);
      running++;
      void Promise.resolve().then(() => batch[0]!.load(
        batch.map(row => row.condition).filter(Boolean),
        [...new Set(batch.flatMap(row => [...row.tokens]))],
      )).then(markets => {
        for (const row of batch) {
          if (entries.get(row.key) !== row) continue;
          const value: MarketMap = new Map();
          for (const key of [row.condition, ...[...row.tokens].map(token => `token:${token}`)]) {
            const market = markets.get(key);
            if (market) value.set(key, structuredClone(market));
          }
          // 查询失败/空响应保留最后已知赛果，下一轮重试，不把未知写成未结算。
          if (value.size) row.value = value;
          row.retryAt = now() + (value.size ? refreshMs : retryMs);
        }
      }).catch(() => {
        for (const row of batch) row.retryAt = now() + retryMs;
      }).finally(() => {
        for (const row of batch) row.pending = false;
        running--;
        drain();
      });
    }
  }

  return {
    read(refs: readonly StoredMarketRef[], load: LoadMarkets): MarketMap {
      const result: MarketMap = new Map();
      for (const ref of refs) {
        const condition = String(ref.conditionId ?? "").trim().toLowerCase();
        const token = String(ref.tokenId ?? "").trim().toLowerCase();
        const key = condition || (token ? `token:${token}` : "");
        if (!key) continue;
        let row = entries.get(key);
        if (!row) {
          if (entries.size >= maxEntries) {
            const idle = [...entries.values()].find(entry => !entry.pending);
            if (!idle) continue;
            entries.delete(idle.key);
          }
          row = { key, condition, tokens: new Set(), value: new Map(), retryAt: 0, pending: false, load };
          entries.set(key, row);
        }
        if (token) row.tokens.add(token);
        for (const [id, market] of row.value) result.set(id, structuredClone(market));
        if (!row.pending && now() >= row.retryAt) {
          row.pending = true;
          queue.push(row);
        }
      }
      // 合并本轮盘口后才启动批量查询；调用者立即获得快照，绝不等待队列。
      queueMicrotask(drain);
      return result;
    },
    clear(): void { entries.clear(); queue.length = 0; },
  };
}

export const storedMarketRefresh = createStoredMarketRefresh();
