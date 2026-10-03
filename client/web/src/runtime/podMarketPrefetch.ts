/**
 * 出票后预检：oid 走 queryBetAmountPB；缺档拉详情盘。
 * 结果叠进跟单 live reader，不写电竞 fo。
 */
import { fetchObFootballMatchMarkets } from "@/runtime/obSportFootballFetch";
import {
  buildObSportQueryBetAmountBody,
  OB_SPORT_QUERY_MARKET_PATH,
  obSportPlayIdFromMarketCode,
  obSportPlayOptions,
  pickObSportMarketInfo,
} from "@/runtime/obSportPlaceBet";
import { postObSportPb } from "@/runtime/obSportFootballFetch";
import type { PodBoardMarket } from "@/runtime/podFixtureMatch";
import { readLocalSportObSession, type SportObSessionLocal } from "@/runtime/obSportSessionLocal";
import { pickObSportBetAccount, sportObSessionFromAccount } from "@/runtime/obSportBetAccount";
import { readPodBetSettings } from "@/runtime/podBetSettings";
import { useAccountStore } from "@/stores/accountStore";

// 自动下注只能消费近实时预检价；页面盘口列表仍可使用较长 MARKET_TTL_MS。
const OID_TTL_MS = 3_000;
const MARKET_TTL_MS = 30_000;

const oidQuotes = new Map<string, { at: number; odds: number }>();
const markets = new Map<string, { at: number; rows: PodBoardMarket[] }>();
const oidInflight = new Map<string, Promise<number>>();
const marketInflight = new Map<string, Promise<PodBoardMarket[]>>();
let version = 0;
let generation = 0;
const listeners = new Set<() => void>();

export function resetPodMarketPrefetch() {
  generation += 1;
  oidQuotes.clear();
  markets.clear();
  oidInflight.clear();
  marketInflight.clear();
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
  const settings = readPodBetSettings();
  const account = pickObSportBetAccount(
    useAccountStore().accounts,
    settings.followAccountIds[0] || settings.followAccountId,
  );
  const session = sportObSessionFromAccount(account);
  if (!session?.token)
    return readLocalSportObSession();
  const collect = readLocalSportObSession();
  if (!session.gateway)
    session.gateway = String(collect?.gateway || "").trim();
  return session;
}

export function peekPrefetchedObOdds(oid: string): number {
  const id = String(oid || "").trim();
  const row = oidQuotes.get(id);
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
  opts: { marketCode?: string; boardSide?: string; odds?: number } = {},
): Promise<number> {
  const id = String(oid || "").trim();
  const matchId = String(mid || "").trim();
  if (!id || !matchId)
    return 0;
  const cached = peekPrefetchedObOdds(id);
  if (cached > 0)
    return cached;
  const pending = oidInflight.get(id);
  if (pending)
    return pending;
  const session = placeSession();
  if (!session?.token || !session.gateway)
    return 0;
  const startedGeneration = generation;
  const work = (async () => {
    try {
      const queried = await postObSportPb(
        OB_SPORT_QUERY_MARKET_PATH,
        buildObSportQueryBetAmountBody({
          oid: id,
          mid: matchId,
          odds: Number(opts.odds) || 0,
          hpid: obSportPlayIdFromMarketCode(opts.marketCode),
          playOptions: obSportPlayOptions(opts.boardSide),
        }),
        session,
      );
      const info = pickObSportMarketInfo(queried, id);
      const odds = Number(info?.odds) || 0;
      if (odds > 1 && startedGeneration === generation) {
        oidQuotes.set(id, { at: Date.now(), odds });
        bump();
      }
      return odds > 1 ? odds : 0;
    }
    catch {
      return 0;
    }
    finally {
      oidInflight.delete(id);
    }
  })();
  oidInflight.set(id, work);
  return work;
}

export async function prefetchObSportMatchMarkets(mid: string): Promise<PodBoardMarket[]> {
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
      const rows = podBoardMarketsFromObDetail(await fetchObFootballMatchMarkets(id, { includeDetail: true }));
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
