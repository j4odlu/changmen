import type { PolymarketMarketIndex, PolymarketMarketIndexEntry } from "@changmen/api-contract";
import type { CollectBetDto } from "@changmen/client-core/types/collect";

import type { PolymarketMappedMarket } from "../parse";

export function isPolymarketMarketIndex(value: unknown): value is PolymarketMarketIndex {
  if (!value || typeof value !== "object")
    return false;
  const row = value as PolymarketMarketIndex;
  return Array.isArray(row.entries) && Array.isArray(row.assetIds);
}

export function indexEntryToMappedMarket(entry: PolymarketMarketIndexEntry): PolymarketMappedMarket {
  const sourceMatchId = String(entry.sourceMatchId);
  const marketId = String(entry.marketId);
  const homeTokenId = String(entry.homeTokenId);
  const awayTokenId = String(entry.awayTokenId);
  const homeName = String(entry.homeName);
  const awayName = String(entry.awayName);
  const homeOdds = Number(entry.homeOdds) || 0;
  const awayOdds = Number(entry.awayOdds) || 0;
  const status = String(entry.status ?? "Locked");
  const map = Number(entry.map) || 0;

  return {
    marketId,
    assetIds: [homeTokenId, awayTokenId],
    match: {
      Type: "Polymarket",
      SourceMatchID: sourceMatchId,
      SourceGameID: "",
      StartTime: 0,
      HomeID: "",
      Home: homeName,
      AwayID: "",
      Away: awayName,
      Teams: [],
    },
    bet: {
      Type: "Polymarket",
      SourceMatchID: sourceMatchId,
      SourceBetID: String(entry.sourceBetId || marketId),
      Map: map,
      BetName: map > 0 ? `[地图${map}] 获胜者` : "[全场] 获胜者",
      SourceHomeID: homeTokenId,
      HomeName: homeName,
      HomeOdds: homeOdds,
      SourceAwayID: awayTokenId,
      AwayName: awayName,
      AwayOdds: awayOdds,
      Status: status,
    },
  };
}

export function applyPolymarketMarketIndex(
  index: PolymarketMarketIndex | null | undefined,
  maps: {
    marketsById: Map<string, PolymarketMappedMarket>;
    assetToMarket: Map<string, string>;
  },
): string[] {
  maps.marketsById.clear();
  maps.assetToMarket.clear();
  if (!index?.entries?.length)
    return [];

  for (const entry of index.entries) {
    const mapped = indexEntryToMappedMarket(entry);
    maps.marketsById.set(mapped.marketId, mapped);
    maps.assetToMarket.set(mapped.assetIds[0]!, mapped.marketId);
    maps.assetToMarket.set(mapped.assetIds[1]!, mapped.marketId);
  }

  return [...new Set((index.assetIds ?? []).map(String).filter(Boolean))];
}

export function mappedBetFromIndex(entry: PolymarketMarketIndexEntry): CollectBetDto {
  return indexEntryToMappedMarket(entry).bet;
}
