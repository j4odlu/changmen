/**
 * [changmen 扩展] VPS MarketIndex 下发的官方地图/全场胜负 + 直播来源；浏览器只读展示。
 */
import type {
  PolymarketMapOutcomeSide,
  PolymarketMarketIndex,
  PolymarketMarketIndexEntry,
} from "@changmen/api-contract";
import { shallowRef } from "vue";

export interface PmMapOutcomeHit {
  winningTokenId: string;
  mapOutcome: PolymarketMapOutcomeSide;
  outcomeKind: "official";
  homeName: string;
  awayName: string;
  map: number;
  marketId: string;
}

/** BetRow / MatchCard 依赖此 tick 在 Index 刷新后重算 */
export const pmMapOutcomeTick = shallowRef(0);

const byTokenId = new Map<string, PmMapOutcomeHit>();
/** sourceMatchId → Gamma resolutionSource URL */
const resolutionBySourceMatchId = new Map<string, string>();

function hitFromEntry(entry: PolymarketMarketIndexEntry): PmMapOutcomeHit | null {
  const side = entry.mapOutcome;
  if (side !== "home" && side !== "away")
    return null;
  // [changmen 扩展] 地图与全场 WIN 均只认官方胜方；忽略旧 Index 的价格判赢及缺失依据。
  if (entry.outcomeKind !== "official")
    return null;
  return {
    winningTokenId: String(side === "home" ? entry.homeTokenId ?? "" : entry.awayTokenId ?? ""),
    mapOutcome: side,
    outcomeKind: "official",
    homeName: String(entry.homeName ?? ""),
    awayName: String(entry.awayName ?? ""),
    map: Number(entry.map) || 0,
    marketId: String(entry.marketId ?? ""),
  };
}

/** Index 同步后替换本地胜负表；直播来源对已见过的 sourceMatchId 做 sticky（closed 出 Index 后仍可展示） */
export function replacePmMapOutcomesFromIndex(index: PolymarketMarketIndex | null | undefined): void {
  if (index == null) {
    byTokenId.clear();
    resolutionBySourceMatchId.clear();
    pmMapOutcomeTick.value += 1;
    return;
  }
  const prevRs = new Map(resolutionBySourceMatchId);
  byTokenId.clear();
  resolutionBySourceMatchId.clear();
  for (const entry of index.entries ?? []) {
    const sourceMatchId = String(entry.sourceMatchId ?? "").trim();
    const eventSlug = String(entry.eventSlug ?? "").trim();
    const rs = String(entry.resolutionSource ?? "").trim();
    if (sourceMatchId && rs && !resolutionBySourceMatchId.has(sourceMatchId))
      resolutionBySourceMatchId.set(sourceMatchId, rs);
    // Matchs.Polymarket 可能是 slug 而 Index 主键是 event.id
    if (eventSlug && rs && eventSlug !== sourceMatchId && !resolutionBySourceMatchId.has(eventSlug))
      resolutionBySourceMatchId.set(eventSlug, rs);

    const hit = hitFromEntry(entry);
    if (!hit)
      continue;
    const home = String(entry.homeTokenId ?? "").trim();
    const away = String(entry.awayTokenId ?? "").trim();
    if (home)
      byTokenId.set(home, hit);
    if (away)
      byTokenId.set(away, hit);
  }
  // 仍在 Index 但本轮无 URL / 已离开 Index：保留旧来源（关盘后仍显示）
  for (const [id, url] of prevRs) {
    if (!resolutionBySourceMatchId.has(id))
      resolutionBySourceMatchId.set(id, url);
  }
  pmMapOutcomeTick.value += 1;
}

export function lookupPmMapOutcomeByToken(tokenId: string | undefined | null): PmMapOutcomeHit | null {
  void pmMapOutcomeTick.value;
  const id = String(tokenId ?? "").trim();
  if (!id)
    return null;
  return byTokenId.get(id) ?? null;
}

/** 按 Polymarket SourceMatchID（Matchs.Polymarket）取直播/裁定来源 URL */
export function lookupResolutionSourceBySourceMatchId(
  sourceMatchId: string | number | undefined | null,
): string | null {
  void pmMapOutcomeTick.value;
  const id = String(sourceMatchId ?? "").trim();
  if (!id)
    return null;
  return resolutionBySourceMatchId.get(id) ?? null;
}

/** 展示用胜方队名：优先盘口 home/away 名，否则 Index 名 */
export function pmMapOutcomeWinnerLabel(
  hit: PmMapOutcomeHit,
  betHomeName?: string,
  betAwayName?: string,
): string {
  if (hit.mapOutcome === "home")
    return String(betHomeName || hit.homeName || "主队").trim() || "主队";
  return String(betAwayName || hit.awayName || "客队").trim() || "客队";
}
