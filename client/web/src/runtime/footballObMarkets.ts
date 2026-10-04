import { fetchObFootballMatchMarkets } from "@/runtime/obSportFootballFetch";

/** M = WS/推送覆盖；H = HTTP 快照。与电竞盘口角标同义。 */
export type FootballOddsSource = "M" | "H";

export type FootballSelection = {
  Name?: string;
  Odds?: number;
  Side?: string;
  OddID?: string;
  BetID?: string;
  MatchID?: string;
  Source?: FootballOddsSource;
};

export type FootballVenueOdds = {
  venue: string;
  Selections: FootballSelection[];
};

export type FootballObMarketRow = {
  hpid?: string;
  Name?: string;
  MarketCode?: string;
  Line?: number | null;
  Period?: string;
  Selections?: FootballSelection[];
  /** 电竞 BetRow 同款：一行一场馆。缺省则把 Selections 当单馆。 */
  Venues?: FootballVenueOdds[];
};

export function footballRowHasQuotes(row: FootballObMarketRow | null | undefined): boolean {
  if (!row)
    return false;
  if ((row.Venues || []).some(v => (v.Selections || []).length > 0))
    return true;
  return (row.Selections || []).length > 0;
}

export function footballRowVenues(row: FootballObMarketRow | null | undefined): FootballVenueOdds[] {
  if (!row)
    return [];
  if (row.Venues?.length)
    return row.Venues;
  if ((row.Selections || []).length)
    return [{ venue: "", Selections: row.Selections || [] }];
  return [];
}

const cache = new Map<string, { at: number; rows: FootballObMarketRow[] }>();
const inflight = new Map<string, Promise<FootballObMarketRow[]>>();
let active = 0;
const waiters: Array<() => void> = [];
const CONCURRENCY = 4;
const CACHE_TTL_MS = 45_000;

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= CONCURRENCY)
    await new Promise<void>(resolve => waiters.push(resolve));
  active += 1;
  try {
    return await fn();
  }
  finally {
    active -= 1;
    waiters.shift()?.();
  }
}

export function peekFootballObMarkets(mid: string): FootballObMarketRow[] | undefined {
  const id = String(mid || "").trim();
  const hit = cache.get(id);
  if (!hit)
    return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(id);
    return undefined;
  }
  return hit.rows;
}

export function invalidateFootballObMarkets(mid: string) {
  const id = String(mid || "").trim();
  if (id)
    cache.delete(id);
}

/** 本 TTL 内打过详情（含空结果）就不再自动重打。 */
export function isFootballObMarketsComplete(rows: FootballObMarketRow[] | undefined): boolean {
  return Array.isArray(rows);
}

export function loadFootballObMarkets(mid: string, force = false): Promise<FootballObMarketRow[]> {
  const id = String(mid || "").trim();
  if (!id)
    return Promise.resolve([]);
  // [changmen 扩展] 变盘刷新也复用正在排队/执行的同场请求，避免推送堆积详情请求。
  const pending = inflight.get(id);
  if (pending)
    return pending;
  if (force)
    cache.delete(id);
  const cached = peekFootballObMarkets(id);
  if (cached && !force)
    return Promise.resolve(cached);
  const job = withSlot(async () => {
    const list = await fetchObFootballMatchMarkets(id);
    const rows = Array.isArray(list) ? list as FootballObMarketRow[] : [];
    cache.set(id, { at: Date.now(), rows });
    return rows;
  }).finally(() => {
    inflight.delete(id);
  });
  inflight.set(id, job);
  return job;
}
