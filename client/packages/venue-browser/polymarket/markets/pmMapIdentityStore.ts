import type { PolymarketMarketIndex, PolymarketMarketIndexEntry } from "@changmen/api-contract";

/** [changmen 扩展] 只读盘口身份，用于把 PM 比分队名映射到合场 token，不参与官方结算。 */
export type PmMapIdentity = Pick<PolymarketMarketIndexEntry,
  "sourceMatchId" | "eventSlug" | "marketId" | "map" | "homeTokenId" | "awayTokenId" | "homeName" | "awayName">;

const byTokenId = new Map<string, PmMapIdentity>();

export function replacePmMapIdentitiesFromIndex(index: PolymarketMarketIndex | null | undefined): void {
  byTokenId.clear();
  for (const entry of [...(index?.entries ?? []), ...(index?.outcomeEntries ?? [])]) {
    if (!entry.homeTokenId || !entry.awayTokenId || entry.homeTokenId === entry.awayTokenId)
      continue;
    const { sourceMatchId, eventSlug, marketId, map, homeTokenId, awayTokenId, homeName, awayName } = entry;
    const identity = { sourceMatchId, eventSlug, marketId, map, homeTokenId, awayTokenId, homeName, awayName };
    byTokenId.set(homeTokenId, identity);
    byTokenId.set(awayTokenId, identity);
  }
}

export function lookupPmMapIdentityByToken(tokenId: string | undefined): PmMapIdentity | null {
  return tokenId ? byTokenId.get(tokenId) ?? null : null;
}
