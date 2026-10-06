import { fetchGammaMarketByTokenId, parseJsonArray, POLYMARKET_DATA_API } from "@changmen/venue-adapter/polymarket";
import { polymarketPluginGet } from "@changmen/venue-adapter/polymarket/transport";

export interface PrematchProbability {
  home: number;
  away: number;
  homeTime: number;
  awayTime: number;
  resolution: number;
  cutoff: number;
}

export type PrematchResult =
  | { status: "ready"; value: PrematchProbability }
  | { status: "pending" | "missing" };

interface HistoryPoint { timestamp: number; price: number | string; resolution_seconds: number }

/** [changmen 扩展] 按 PM 登记开赛时间取历史价；不是实际清单事件价。 */
export function readPrematchPoint(data: unknown, cutoff: number): HistoryPoint | null {
  if (!Array.isArray(data))
    return null;
  return data.filter((p): p is HistoryPoint => {
    if (!p || typeof p !== "object")
      return false;
    const price = p.price;
    return (typeof price === "number" || (typeof price === "string" && price.trim() !== ""))
      && Number.isFinite(Number(price)) && Number(price) >= 0 && Number(price) <= 1
      && Number.isFinite(p.timestamp) && p.timestamp > 0 && p.timestamp <= cutoff
      && Number.isFinite(p.resolution_seconds) && p.resolution_seconds >= 0;
  }).sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

const cache = new Map<string, { until: number; value: Promise<PrematchResult> }>();
let active = 0;
const queue: Array<() => void> = [];
async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 4)
    await new Promise<void>(resolve => queue.push(resolve));
  else
    active++;
  try { return await run(); }
  finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}

export function loadPrematchProbability(homeId: string, awayId: string): Promise<PrematchResult> {
  const key = `${homeId}:${awayId}`;
  const existing = cache.get(key);
  if (existing && existing.until > Date.now())
    return existing.value;
  const entry = { until: Infinity, value: Promise.resolve<PrematchResult>({ status: "missing" }) };
  entry.value = limited(async (): Promise<PrematchResult> => {
    const market = await fetchGammaMarketByTokenId(homeId);
    const ids = parseJsonArray(market?.clobTokenIds);
    if (!market || !["moneyline", "child_moneyline"].includes(market.sportsMarketType ?? "") || !ids.includes(homeId) || !ids.includes(awayId))
      return { status: "missing" };
    // 不回退到市场创建时间、客户端合场时间或 live 状态。
    const start = Date.parse(String(market.gameStartTime ?? ""));
    if (!Number.isFinite(start))
      return { status: "missing" };
    if (start > Date.now())
      return { status: "pending" };
    const cutoff = Math.floor(start / 1000) - 1;
    const read = async (tokenId: string) => {
      const params = new URLSearchParams({ token_id: tokenId, as_of: String(cutoff) });
      const response = await polymarketPluginGet<{ data?: unknown }>(`${POLYMARKET_DATA_API}/v2/prices-history?${params}`);
      return readPrematchPoint(response?.data, cutoff);
    };
    const [home, away] = await Promise.all([read(homeId), read(awayId)]);
    if (!home || !away)
      return { status: "missing" };
    return { status: "ready", value: {
      home: Number(home.price) * 100, away: Number(away.price) * 100,
      homeTime: home.timestamp * 1000, awayTime: away.timestamp * 1000,
      resolution: Math.max(home.resolution_seconds, away.resolution_seconds), cutoff: cutoff * 1000,
    } };
  }).then(result => {
    entry.until = Date.now() + (result.status === "ready" ? 600_000 : 60_000);
    return result;
  }, error => {
    entry.until = Date.now() + 60_000;
    throw error;
  });
  if (cache.size >= 500)
    cache.delete(cache.keys().next().value!);
  cache.set(key, entry);
  return entry.value;
}
