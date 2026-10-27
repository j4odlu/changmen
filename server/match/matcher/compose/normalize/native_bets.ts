/**
 * 从 platform_bets 取原生盘口 Source。
 */
import type { OptionalIdentityId } from "@changmen/match-identity/types";
import type { ClonedBetSource, NativeBetSource, PlatformBetBuckets, RawBetSourceInput, SavedBetBucket, SavedBetInput } from "./types.ts";
import { formatOdds, truncateOddsTo3 } from "@changmen/shared/odds_format";
import {
  iaLegacyWinBetName,
  matchesSavedBet,
  obLegacyWinBetName,
  obSavedBetIsMatchWinner,
  rayLegacyWinBetName,
} from "@changmen/shared/catalog/market_catalog";
import { readPredictFunMarketIndex } from "@changmen/storage/predictfun_market_index";

export function betBucketKey(platform: string, sourceMatchId: OptionalIdentityId): string {
  return `${platform}:${sourceMatchId}`;
}

let pfTokenMarketCache = { updatedAt: -1, byToken: new Map<string, string>() };

function predictFunMarketIdByToken(tokenId: unknown): string {
  const tok = String(tokenId || "").trim();
  if (!tok)
    return "";
  const index = readPredictFunMarketIndex();
  const updatedAt = Number(index?.updatedAt) || 0;
  if (updatedAt !== pfTokenMarketCache.updatedAt) {
    const byToken = new Map<string, string>();
    for (const entry of index?.entries || []) {
      const homeMid = String(entry.homeMarketId || "").trim();
      const awayMid = String(entry.awayMarketId || homeMid).trim();
      const homeTok = String(entry.homeTokenId || "").trim();
      const awayTok = String(entry.awayTokenId || "").trim();
      if (homeTok && homeMid)
        byToken.set(homeTok, homeMid);
      if (awayTok && awayMid)
        byToken.set(awayTok, awayMid);
    }
    pfTokenMarketCache = { updatedAt, byToken };
  }
  return pfTokenMarketCache.byToken.get(tok) || "";
}

function winPriority(bet: SavedBetInput, provider: string, gameCode?: string | null): number {
  const name = String(bet?.BetName ?? bet?.Name ?? "");
  if (name.includes("+"))
    return 0;
  if (provider === "OB" && gameCode && obSavedBetIsMatchWinner(bet, gameCode))
    return 200;
  if (provider === "OB" && obLegacyWinBetName(name))
    return 150;
  if (provider === "RAY" && rayLegacyWinBetName(name))
    return 100;
  if (provider === "IA" && iaLegacyWinBetName(name))
    return 100;
  if (provider === "Polymarket" || provider === "PredictFun")
    return 120;
  return 10;
}

function isWinBet(bet: SavedBetInput, provider: string, gameCode?: string | null): boolean {
  const name = String(bet?.BetName ?? bet?.Name ?? "");
  if (name.includes("+"))
    return false;
  if (provider === "OB") {
    if (gameCode && obSavedBetIsMatchWinner(bet, gameCode))
      return true;
    return obLegacyWinBetName(name);
  }
  if (provider === "RAY")
    return matchesSavedBet("RAY", bet, { gameCode }) || rayLegacyWinBetName(name);
  if (provider === "IA")
    return matchesSavedBet("IA", bet, { gameCode }) || iaLegacyWinBetName(name);
  if (provider === "Polymarket" || provider === "PredictFun" || provider === "PB" || provider === "TF")
    return true;
  return Boolean(bet?.SourceHomeID || bet?.SourceAwayID);
}

export function cloneRawSource(src: NativeBetSource | null | undefined): NativeBetSource | null;
export function cloneRawSource(src: RawBetSourceInput | null | undefined): ClonedBetSource | null;
export function cloneRawSource(src: RawBetSourceInput | null | undefined): ClonedBetSource | null {
  if (!src)
    return null;
  return {
    Type: src.Type,
    BetID: String(src.BetID ?? ""),
    HomeID: String(src.HomeID ?? ""),
    AwayID: String(src.AwayID ?? ""),
    HomeOdds: src.HomeOdds,
    AwayOdds: src.AwayOdds,
    Status: src.Status || "Normal",
    ...(src.HomeMarketID ? { HomeMarketID: String(src.HomeMarketID) } : {}),
    ...(src.AwayMarketID ? { AwayMarketID: String(src.AwayMarketID) } : {}),
    ...(Number(src.LineID) > 0 ? { LineID: Number(src.LineID) } : {}),
  };
}

export function sourceFromBet(provider: string, b: SavedBetInput): NativeBetSource {
  const homeRaw = Number(b.HomeOdds) || 0;
  const awayRaw = Number(b.AwayOdds) || 0;
  const useTrunc = provider === "Polymarket" || provider === "PredictFun";
  const src: NativeBetSource = {
    Type: provider,
    BetID: String(b.SourceBetID),
    HomeID: String(b.SourceHomeID || ""),
    AwayID: String(b.SourceAwayID || ""),
    HomeOdds: useTrunc ? truncateOddsTo3(homeRaw) : formatOdds(homeRaw),
    AwayOdds: useTrunc ? truncateOddsTo3(awayRaw) : formatOdds(awayRaw),
    Status: b.Status || "Normal",
  };
  if (provider === "PredictFun") {
    const mid = String(b.MarketID || "").trim()
      || predictFunMarketIdByToken(src.HomeID)
      || predictFunMarketIdByToken(src.AwayID);
    if (mid) {
      src.HomeMarketID = mid;
      src.AwayMarketID = mid;
    }
  }
  const lineId = Number(b.LineID) || 0;
  if (lineId > 0)
    src.LineID = lineId;
  return src;
}

/** mapNum → raw Source */
export function nativeSourcesByMap(platform: string, sourceMatchId: OptionalIdentityId, bets: PlatformBetBuckets | null | undefined, gameCode?: string | null): Map<number, NativeBetSource> {
  const block = bets?.[betBucketKey(platform, sourceMatchId)]
    || bets?.[`${platform}:${String(sourceMatchId)}`];
  const list: readonly SavedBetInput[] = Array.isArray(block) ? block : ((block as SavedBetBucket | null | undefined)?.bets || []);
  const byMap = new Map<number, SavedBetInput>();
  for (const bet of list) {
    if (!isWinBet(bet, platform, gameCode))
      continue;
    const mapNum = Number(bet.Map) || 0;
    const prev = byMap.get(mapNum);
    if (!prev || winPriority(bet, platform, gameCode) > winPriority(prev, platform, gameCode))
      byMap.set(mapNum, bet);
  }
  const out = new Map<number, NativeBetSource>();
  for (const [mapNum, bet] of byMap)
    out.set(mapNum, sourceFromBet(platform, bet));
  return out;
}

export function rawSourceForMap(platform: string, sourceMatchId: OptionalIdentityId, mapNum: unknown, bets: PlatformBetBuckets | null | undefined, gameCode?: string | null): NativeBetSource | null {
  const byMap = nativeSourcesByMap(platform, sourceMatchId, bets, gameCode);
  return cloneRawSource(byMap.get(Number(mapNum) || 0) || null);
}
