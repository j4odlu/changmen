/**
 * [changmen 扩展] 试玩 HTTP 补充缺失/过期的 WS 报价；下注账号仍独立预检。
 * 结果叠进跟单 live reader，不写电竞 fo。
 */
import { fetchObFootballMatchMarkets } from "@/runtime/obSportFootballFetch";
import {
  findObSportOidMetaInDetail,
} from "@/runtime/obSportPlaceBet";
import { postObSportPb } from "@/runtime/obSportFootballFetch";
import type { PodBoardMarket } from "@/runtime/podFixtureMatch";
import { readLocalSportObSession, type SportObSessionLocal } from "@/runtime/obSportSessionLocal";
import { clearPodPrefetchQueue, runPodPrefetch } from "@/runtime/podPrefetchQueue";

// 自动下注只能消费近实时试玩报价；页面盘口列表仍可使用较长 MARKET_TTL_MS。
const OID_TTL_MS = 3_000;
const MARKET_TTL_MS = 30_000;

const oidQuotes = new Map<string, { at: number; odds: number }>();
const markets = new Map<string, { at: number; rows: PodBoardMarket[] }>();
const oidInflight = new Map<string, Promise<number>>();
const marketInflight = new Map<string, Promise<PodBoardMarket[]>>();
const trialDetails = new Map<string, { at: number; data: unknown }>();
const trialDetailInflight = new Map<string, Promise<unknown>>();
let version = 0;
let generation = 0;
const listeners = new Set<() => void>();

export function resetPodMarketPrefetch() {
  generation += 1;
  clearPodPrefetchQueue();
  oidQuotes.clear();
  markets.clear();
  oidInflight.clear();
  marketInflight.clear();
  trialDetails.clear();
  trialDetailInflight.clear();
  bump();
}

function bump() {
  version += 1;
  for (const fn of listeners)
    fn();
}

export function subscribePodMarketPrefetch(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function podMarketPrefetchVersion(): number {
  return version;
}

function placeSession(): SportObSessionLocal | null {
  return readLocalSportObSession();
}

function quoteKey(oid: string, session = placeSession()): string {
  return `${session?.gateway || ""}|${session?.token || ""}|${oid}`;
}

export function hasPrefetchedObOdds(oid: string): boolean {
  const row = oidQuotes.get(quoteKey(String(oid || "").trim()));
  return !!row && Date.now() - row.at <= OID_TTL_MS;
}

export function peekPrefetchedObOdds(oid: string): number {
  const id = String(oid || "").trim();
  const row = oidQuotes.get(quoteKey(id));
  if (!row || Date.now() - row.at > OID_TTL_MS)
    return 0;
  return row.odds;
}

export function listPrefetchedObMarkets(mid: string): PodBoardMarket[] {
  const id = String(mid || "").trim();
  const row = markets.get(id);
  if (!row || Date.now() - row.at > MARKET_TTL_MS)
    return [];
  return row.rows;
}

function selSide(raw: unknown): string {
  return String(raw || "").trim().toLowerCase();
}

export function podBoardMarketsFromObDetail(
  rows: Array<{
    Name?: string;
    MarketCode?: string;
    Line?: number | null;
    Selections?: Array<{ Name?: string; Odds?: number; Side?: string; OddID?: string }>;
  }>,
): PodBoardMarket[] {
  return (rows || []).map((row, i) => {
    const sels = row.Selections || [];
    const pick = (...sides: string[]) => sels.find(s => sides.includes(selSide(s.Side))
      || sides.includes(String(s.Name || "").trim().toLowerCase()));
    const home = pick("home", "over", "大", "大球");
    const away = pick("away", "under", "小", "小球");
    const draw = pick("draw", "平");
    return {
      id: i + 1,
      marketCode: String(row.MarketCode || "").toLowerCase(),
      line: row.Line ?? null,
      name: String(row.Name || "").trim(),
      ob: true,
      quoteHome: Number(home?.Odds) || 0,
      quoteAway: Number(away?.Odds) || 0,
      quoteDraw: Number(draw?.Odds) || 0,
      oidHome: String(home?.OddID || "").trim(),
      oidAway: String(away?.OddID || "").trim(),
      oidDraw: String(draw?.OddID || "").trim(),
    };
  }).filter(row => row.marketCode && (row.oidHome || row.oidAway));
}

export async function prefetchObSportOidQuote(
  oid: string,
  mid = "",
  opts: { marketCode?: string; boardSide?: string; odds?: number; submitBefore?: number } = {},
): Promise<number> {
  const id = String(oid || "").trim();
  const matchId = String(mid || "").trim();
  if (!id || !matchId)
    return 0;
  const session = placeSession();
  if (!session?.token || !session.gateway)
    return 0;
  const key = quoteKey(id, session);
  if (hasPrefetchedObOdds(id))
    return peekPrefetchedObOdds(id);
  const pending = oidInflight.get(key);
  if (pending)
    return pending;
  const startedGeneration = generation;
  const work = (async () => {
    // 先登记 inflight；命中同场快照时也必须等到登记完成后再清理。
    await Promise.resolve();
    try {
      if (startedGeneration !== generation)
        return 0;
      const detailKey = quoteKey(`mid:${matchId}`, session);
      const cachedDetail = trialDetails.get(detailKey);
      let queried: unknown;
      if (cachedDetail && Date.now() - cachedDetail.at <= OID_TTL_MS) {
        queried = cachedDetail.data;
      }
      else {
        let pendingDetail = trialDetailInflight.get(detailKey);
        if (!pendingDetail) {
          pendingDetail = runPodPrefetch(() => {
            if (startedGeneration !== generation)
              return Promise.resolve(null);
            return postObSportPb(
              "/yewu11/v1/w/getMatchBaseInfoByOddsPB",
              { mid: matchId, cuid: session.sessionId || session.uid || "0", cos: 0, orpt: 0, euid: "3020101", mcid: 0, newUser: 0 },
              session,
            );
          }, opts.submitBefore).then(data => {
            if (data != null && startedGeneration === generation)
              trialDetails.set(detailKey, { at: Date.now(), data });
            return data;
          }).finally(() => {
            if (startedGeneration === generation)
              trialDetailInflight.delete(detailKey);
          });
          trialDetailInflight.set(detailKey, pendingDetail);
        }
        queried = await pendingDetail;
      }
      if (queried == null)
        return 0;
      const info = findObSportOidMetaInDetail(queried, id);
      const odds = Number(info?.odds) || 0;
      if (info && startedGeneration === generation) {
        oidQuotes.set(key, { at: trialDetails.get(detailKey)?.at ?? Date.now(), odds });
        bump();
      }
      return odds > 1 ? odds : 0;
    }
    catch {
      return 0;
    }
    finally {
      if (startedGeneration === generation)
        oidInflight.delete(key);
    }
  })();
  oidInflight.set(key, work);
  return work;
}

export async function prefetchObSportMatchMarkets(mid: string, submitBefore?: number): Promise<PodBoardMarket[]> {
  const id = String(mid || "").trim();
  if (!id)
    return [];
  const cached = listPrefetchedObMarkets(id);
  if (cached.length)
    return cached;
  const pending = marketInflight.get(id);
  if (pending)
    return pending;
  const startedGeneration = generation;
  const work = (async () => {
    try {
      // 仅在跟单目标盘未命中时调用：列表有其它盘口也不能省掉详情补线。
      const fetched = await runPodPrefetch(() => startedGeneration === generation
        ? fetchObFootballMatchMarkets(id, { includeDetail: true }) : Promise.resolve([]), submitBefore);
      const rows = podBoardMarketsFromObDetail(fetched || []);
      if (rows.length && startedGeneration === generation) {
        markets.set(id, { at: Date.now(), rows });
        bump();
      }
      return rows;
    }
    catch {
      return [];
    }
    finally {
      if (startedGeneration === generation)
        marketInflight.delete(id);
    }
  })();
  marketInflight.set(id, work);
  return work;
}

export function mergePodBoardMarkets(
  base: PodBoardMarket[] | undefined,
  extra: PodBoardMarket[] | undefined,
): PodBoardMarket[] {
  const out: PodBoardMarket[] = [];
  const seen = new Set<string>();
  // extra 是刚从比赛详情预取的数据；同盘同线时必须覆盖旧快照的 oid/锁盘/赔率。
  for (const row of [...(extra || []), ...(base || [])]) {
    const key = `${row.marketCode}|${row.line ?? ""}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
