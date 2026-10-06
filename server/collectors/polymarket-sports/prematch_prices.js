/** [changmen 扩展] VPS 统一取登记开赛时间前 1 秒历史价，不代表实际清单时刻。 */
import { fetchPmPrematchPrices, writePmPrematchPrices } from "@changmen/db";

function tokenIds(market) {
  try {
    const ids = typeof market.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
    return Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))] : [];
  }
  catch { return []; }
}

export function readPrematchPoint(data, cutoff) {
  if (!Array.isArray(data)) return null;
  return data.filter(p => p && typeof p === "object"
    && (typeof p.price === "number" || (typeof p.price === "string" && p.price.trim() !== ""))
    && Number.isFinite(Number(p.price)) && Number(p.price) >= 0 && Number(p.price) <= 1
    && Number.isFinite(p.timestamp) && p.timestamp > 0 && p.timestamp <= cutoff
    && Number.isFinite(p.resolution_seconds) && p.resolution_seconds >= 0)
    .sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

async function readHistory(tokenId, cutoff) {
  const params = new URLSearchParams({ token_id: tokenId, as_of: String(cutoff) });
  const response = await fetch(`https://data-api.polymarket.com/v2/prices-history?${params}`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`PM history HTTP ${response.status}`);
  return (await response.json()).data;
}

export async function collectPrematchPrices(event, {
  read = readHistory, load = fetchPmPrematchPrices, save = writePmPrematchPrices, now = Date.now(),
} = {}) {
  const markets = (event?.markets || []).filter(m => ["moneyline", "child_moneyline"].includes(m.sportsMarketType));
  const existing = await load(markets.flatMap(tokenIds));
  const tasks = markets.flatMap(market => {
    const start = Date.parse(String(market.gameStartTime ?? ""));
    const registeredStart = Number.isFinite(start) ? start : null;
    const cutoff = registeredStart == null ? 0 : Math.floor(start / 1000) - 1;
    return tokenIds(market).map(tokenId => ({ tokenId, marketId: String(market.id), registeredStart, cutoff }));
  });
  const records = [];
  // 单个轮询不重叠，最多四个历史请求并发；Gamma 时间每轮重新确认。
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const previous = existing[task.tokenId];
      if (previous?.cutoff === task.cutoff && previous.nextCheckAt > now) continue;
      const base = { ...task, checkedAt: now, nextCheckAt: now + 60_000 };
      if (task.registeredStart == null) {
        records.push({ ...base, status: "missing" });
        continue;
      }
      if (task.registeredStart > now) {
        records.push({ ...base, status: "pending", nextCheckAt: Math.min(now + 60_000, task.registeredStart) });
        continue;
      }
      try {
        const point = readPrematchPoint(await read(task.tokenId, task.cutoff), task.cutoff);
        records.push(point ? { ...base, status: "ready", price: Number(point.price),
          observationTime: point.timestamp * 1000, resolution: point.resolution_seconds,
          nextCheckAt: now + 600_000 } : previous?.status === "ready" && previous.cutoff === task.cutoff
            ? { ...previous, ...base, lastErrorAt: now } : { ...base, status: "missing" });
      }
      catch {
        // 同一截止点的已验证价格保留在 RDS，失败一分钟后重试。
        records.push(previous?.status === "ready" && previous.cutoff === task.cutoff
          ? { ...previous, ...base, lastErrorAt: now }
          : { ...base, status: "error" });
      }
    }
  }));
  await save(records);
  return records.length;
}
