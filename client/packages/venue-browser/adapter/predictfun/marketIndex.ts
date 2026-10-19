import type { PredictFunMarketIndex, PredictFunMarketIndexEntry } from "@changmen/api-contract";
import type { CollectBetDto } from "@changmen/client-core/types/collect";

import type { PredictMappedMarket } from "./parse";

/** tokenId(onChainId) → predict.fun marketId；index 同步时维护，供 checkBet 不依赖 fo */
const tokenToMarketId = new Map<string, string>();

/** 最近一次 MarketIndex，供订单侧栏把旧裸 ID 文案升级为队名 */
let lastMarketIndex: PredictFunMarketIndex | null = null;

export function isPredictFunMarketIndex(value: unknown): value is PredictFunMarketIndex {
  if (!value || typeof value !== "object")
    return false;
  const row = value as PredictFunMarketIndex;
  return Array.isArray(row.entries) && Array.isArray(row.marketIds);
}

export function rememberPredictFunTokenMarketIds(
  index: PredictFunMarketIndex | null | undefined,
): void {
  tokenToMarketId.clear();
  lastMarketIndex = index && isPredictFunMarketIndex(index) ? index : null;
  if (!index?.entries?.length)
    return;
  for (const entry of index.entries) {
    const homeMid = String(entry.homeMarketId || "").trim();
    const awayMid = String(entry.awayMarketId || homeMid).trim();
    const homeTok = String(entry.homeTokenId || "").trim();
    const awayTok = String(entry.awayTokenId || "").trim();
    if (homeTok && homeMid)
      tokenToMarketId.set(homeTok, homeMid);
    if (awayTok && awayMid)
      tokenToMarketId.set(awayTok, awayMid);
  }
}

export function getCachedPredictFunMarketIndex(): PredictFunMarketIndex | null {
  return lastMarketIndex;
}

/** 订单框：裸 marketId/tokenId → 队名/盘口（与服务端 pf_order_labels 同源） */
export function lookupPredictFunOrderLabels(opts: {
  marketId?: string;
  tokenId?: string;
}): { match: string; bet: string; item: string } | null {
  const mid = String(opts.marketId ?? "").trim();
  const tok = String(opts.tokenId ?? "").trim();
  if (!mid && !tok)
    return null;
  const entries = lastMarketIndex?.entries;
  if (!entries?.length)
    return null;
  const entry = entries.find((e) => {
    const homeMid = String(e.homeMarketId || "").trim();
    const awayMid = String(e.awayMarketId || e.homeMarketId || "").trim();
    const homeTok = String(e.homeTokenId || "").trim();
    const awayTok = String(e.awayTokenId || "").trim();
    if (mid && (mid === homeMid || mid === awayMid))
      return true;
    if (tok && (tok === homeTok || tok === awayTok))
      return true;
    return false;
  });
  if (!entry)
    return null;
  const home = String(entry.homeName || "").trim() || "主队";
  const away = String(entry.awayName || "").trim() || "客队";
  const homeTok = String(entry.homeTokenId || "").trim();
  const mapNum = Number(entry.map) || 0;
  const isHome = tok
    ? tok === homeTok
    : mid === String(entry.homeMarketId || "").trim();
  return {
    match: `${home} vs ${away}`,
    bet: mapNum > 0 ? `[地图${mapNum}] 获胜` : "全场胜负",
    item: isHome ? home : away,
  };
}

export function lookupPredictFunMarketIdByToken(tokenId: string): string {
  const id = String(tokenId || "").trim();
  if (!id)
    return "";
  return tokenToMarketId.get(id) || "";
}

/** 测试用 */
export function __resetPredictFunTokenMarketIdsForTests(): void {
  tokenToMarketId.clear();
  lastMarketIndex = null;
}

export function indexEntryToMappedMarket(entry: PredictFunMarketIndexEntry): PredictMappedMarket {
  const sourceMatchId = String(entry.sourceMatchId);
  const categoryId = String(entry.categoryId);
  const homeName = String(entry.homeName);
  const awayName = String(entry.awayName);
  const homeTokenId = String(entry.homeTokenId);
  const awayTokenId = String(entry.awayTokenId);
  const homeOdds = Number(entry.homeOdds) || 0;
  const awayOdds = Number(entry.awayOdds) || 0;
  const status = String(entry.status ?? "Locked");
  const mapNum = Number(entry.map) || 0;
  const homeMarketId = String(entry.homeMarketId);
  const awayMarketId = String(entry.awayMarketId);
  const bet: CollectBetDto & { MarketID?: string } = {
    Type: "PredictFun",
    SourceMatchID: sourceMatchId,
    SourceBetID: String(entry.sourceBetId || categoryId),
    Map: mapNum,
    BetName: mapNum > 0 ? `Game ${mapNum} Winner` : "Match Winner",
    SourceHomeID: homeTokenId,
    HomeName: homeName,
    HomeOdds: homeOdds,
    SourceAwayID: awayTokenId,
    AwayName: awayName,
    AwayOdds: awayOdds,
    Status: status,
  };
  // 单盘双 outcome / 局盘：bet 绑定该盘 marketId（供 token→fo 与订阅）
  if (homeMarketId && homeMarketId === awayMarketId)
    bet.MarketID = homeMarketId;

  return {
    categoryId,
    homeMarketId,
    awayMarketId,
    homeTokenId,
    awayTokenId,
    marketIds: [...new Set([homeMarketId, awayMarketId].filter(Boolean))],
    match: {
      Type: "PredictFun",
      SourceMatchID: sourceMatchId,
      SourceGameID: "",
      StartTime: 0,
      HomeID: "",
      Home: homeName,
      AwayID: "",
      Away: awayName,
      Teams: [],
    },
    bet,
    bets: [bet],
  };
}

export function applyPredictFunMarketIndex(
  index: PredictFunMarketIndex | null | undefined,
  maps: {
    marketsByCategory: Map<string, PredictMappedMarket>;
    marketIdToCategory: Map<string, string>;
  },
): string[] {
  maps.marketsByCategory.clear();
  maps.marketIdToCategory.clear();
  rememberPredictFunTokenMarketIds(index);
  if (!index?.entries?.length)
    return [];

  for (const entry of index.entries) {
    const categoryId = String(entry.categoryId);
    const mappedOne = indexEntryToMappedMarket(entry);
    const existing = maps.marketsByCategory.get(categoryId);
    if (!existing) {
      maps.marketsByCategory.set(categoryId, mappedOne);
    }
    else {
      existing.bets = [...(existing.bets || []), ...mappedOne.bets];
      existing.marketIds = [...new Set([
        ...(existing.marketIds || []),
        ...(mappedOne.marketIds || []),
      ])];
      if (Number(mappedOne.bet.Map) === 0)
        existing.bet = mappedOne.bet;
      // 全场 market id 优先挂在 mapped 顶层，便于旧逻辑
      if (Number(mappedOne.bet.Map) === 0) {
        existing.homeMarketId = mappedOne.homeMarketId;
        existing.awayMarketId = mappedOne.awayMarketId;
        existing.homeTokenId = mappedOne.homeTokenId;
        existing.awayTokenId = mappedOne.awayTokenId;
      }
      // 局盘：保留各自 MarketID（indexEntry 已写在 bet 上）
    }
    if (mappedOne.homeMarketId)
      maps.marketIdToCategory.set(mappedOne.homeMarketId, categoryId);
    if (mappedOne.awayMarketId)
      maps.marketIdToCategory.set(mappedOne.awayMarketId, categoryId);
  }

  return [...new Set((index.marketIds ?? []).map(String).filter(Boolean))];
}

export function mappedBetFromIndex(entry: PredictFunMarketIndexEntry): CollectBetDto {
  return indexEntryToMappedMarket(entry).bet;
}
