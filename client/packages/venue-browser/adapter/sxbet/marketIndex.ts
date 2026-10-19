import type { SxBetMarketIndex, SxBetMarketIndexEntry } from "@changmen/api-contract";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import { PLATFORMS } from "../shared/platforms";

const PLATFORM = PLATFORMS.SXBet;

/** Index 条目 → 浏览器 fo/WS 追踪用（非 discovery） */
export interface SxTrackedMarket {
  marketHash: string;
  homeOddsId: string;
  awayOddsId: string;
  bet: CollectBetDto;
}

export function isSxBetMarketIndex(value: unknown): value is SxBetMarketIndex {
  if (!value || typeof value !== "object")
    return false;
  const row = value as SxBetMarketIndex;
  return Array.isArray(row.entries) && Array.isArray(row.marketHashes);
}

export function indexEntryToTrackedMarket(entry: SxBetMarketIndexEntry): SxTrackedMarket {
  const marketHash = String(entry.marketHash || entry.sourceBetId || "");
  const homeOddsId = String(entry.homeOddsId || `${marketHash}:1`);
  const awayOddsId = String(entry.awayOddsId || `${marketHash}:2`);
  const homeOdds = Number(entry.homeOdds) || 0;
  const awayOdds = Number(entry.awayOdds) || 0;
  const status = String(entry.status ?? "Locked");
  return {
    marketHash,
    homeOddsId,
    awayOddsId,
    bet: {
      Type: PLATFORM,
      SourceMatchID: String(entry.sourceMatchId),
      SourceBetID: String(entry.sourceBetId || marketHash),
      Map: 0,
      BetName: "[全场] 获胜者",
      SourceHomeID: homeOddsId,
      HomeName: String(entry.homeName || ""),
      HomeOdds: homeOdds,
      SourceAwayID: awayOddsId,
      AwayName: String(entry.awayName || ""),
      AwayOdds: awayOdds,
      Status: status,
    },
  };
}

export function applySxBetMarketIndex(
  index: SxBetMarketIndex | null | undefined,
  maps: { marketsByHash: Map<string, SxTrackedMarket> },
): string[] {
  maps.marketsByHash.clear();
  if (!index?.entries?.length)
    return [];

  for (const entry of index.entries) {
    const tracked = indexEntryToTrackedMarket(entry);
    if (!tracked.marketHash)
      continue;
    maps.marketsByHash.set(tracked.marketHash, tracked);
  }

  return [...new Set((index.marketHashes ?? []).map(String).filter(Boolean))];
}
