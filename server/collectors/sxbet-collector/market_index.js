import { writeSxBetMarketIndex } from "@changmen/storage/sxbet_market_index";

/**
 * @param {ReturnType<import("./parse.js").buildSxMappedMarket>[]} candidates
 * @returns {import("@changmen/api-contract").SxBetMarketIndex}
 */
export function buildSxBetMarketIndexPayload(candidates) {
  const marketHashSet = new Set();
  const entries = [];
  for (const mapped of candidates) {
    if (!mapped)
      continue;
    const marketHash = String(mapped.marketHash || mapped.bet?.SourceBetID || "").trim();
    if (!marketHash)
      continue;
    marketHashSet.add(marketHash);
    /** @type {import("@changmen/api-contract").SxBetMarketIndexEntry} */
    const entry = {
      sourceMatchId: String(mapped.match.SourceMatchID),
      marketHash,
      homeOddsId: String(mapped.homeOddsId || mapped.bet.SourceHomeID),
      awayOddsId: String(mapped.awayOddsId || mapped.bet.SourceAwayID),
      sourceBetId: String(mapped.bet.SourceBetID || marketHash),
      homeName: String(mapped.bet.HomeName || mapped.match.Home || ""),
      awayName: String(mapped.bet.AwayName || mapped.match.Away || ""),
      homeOdds: Number(mapped.bet.HomeOdds) || 0,
      awayOdds: Number(mapped.bet.AwayOdds) || 0,
      status: String(mapped.bet.Status ?? "Locked"),
      startTime: Number(mapped.match.StartTime) || undefined,
      gameId: String(mapped.match.SourceGameID || "") || undefined,
    };
    entries.push(entry);
  }
  return {
    updatedAt: Date.now(),
    marketHashes: [...marketHashSet],
    entries,
  };
}

/** @param {ReturnType<import("./parse.js").buildSxMappedMarket>[]} candidates */
export function persistSxBetMarketIndex(candidates) {
  writeSxBetMarketIndex(buildSxBetMarketIndexPayload(candidates));
}
