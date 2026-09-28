import type { PmOddsDropSignal } from "./detector";
import type {
  OddsDropReferenceVenue,
  OddsDropSelection,
  ReferenceVenueQuote,
} from "./runtime";
import type { BetSide, ViewBet, ViewMatch } from "@/models/match";

export interface PmOddsDropVenueQuote {
  odds: number;
  evPercent: number;
}

export interface PmOddsDropVenueSnapshot {
  matchId: number;
  matchTitle: string;
  marketTitle: string;
  side: BetSide;
  sideLabel: string;
  referenceVenue: OddsDropReferenceVenue;
  pm: PmOddsDropVenueQuote | null;
  ob: PmOddsDropVenueQuote | null;
  ray: PmOddsDropVenueQuote | null;
  pb: PmOddsDropVenueQuote | null;
}

/** 与足球 POD 相同口径：(目标场馆赔率 / 基准赔率 - 1) × 100。 */
export function pmVenueEvPercent(venueOdds: number, referenceOdds: number): number {
  if (!(venueOdds > 0) || !(referenceOdds > 1))
    return 0;
  return Math.round((venueOdds / referenceOdds - 1) * 10_000) / 100;
}

export function referenceQuoteKey(selection: OddsDropSelection): string {
  return `${selection.matchId}:${selection.betId}:${selection.side}`;
}

function readBestVenueOddsForBet(
  bet: ViewBet,
  side: BetSide,
  type: OddsDropReferenceVenue,
): number {
  let best = 0;
  for (const item of bet.items) {
    if (item.type !== type)
      continue;
    const odds = Number(item.getOdds(side));
    if (Number.isFinite(odds) && odds > best)
      best = odds;
  }
  return best;
}

function venueQuote(odds: number, referenceOdds: number): PmOddsDropVenueQuote | null {
  if (!(odds > 0))
    return null;
  return {
    odds,
    evPercent: pmVenueEvPercent(odds, referenceOdds),
  };
}

/** OB/RAY/PB 无本模块可用的统一 quote hub，按合场结构只读变价；不写任何业务状态。 */
export function readReferenceVenueQuotes(
  matches: readonly ViewMatch[],
  venue: Exclude<OddsDropReferenceVenue, "Polymarket">,
): ReferenceVenueQuote[] {
  const result: ReferenceVenueQuote[] = [];
  for (const match of matches) {
    for (const bet of match.bets) {
      for (const side of ["Home", "Away"] as const) {
        const odds = readBestVenueOddsForBet(bet, side, venue);
        if (!(odds > 1))
          continue;
        const selection: OddsDropSelection = { matchId: match.id, betId: bet.id, side };
        result.push({ key: referenceQuoteKey(selection), odds, selection });
      }
    }
  }
  return result;
}

function locateSelection(
  matches: readonly ViewMatch[],
  signal: PmOddsDropSignal,
  referenceVenue: OddsDropReferenceVenue,
  selection: OddsDropSelection | null,
): { match: ViewMatch; bet: ViewBet; side: BetSide } | null {
  if (selection) {
    const match = matches.find(row => row.id === selection.matchId);
    const bet = match?.bets.find(row => row.id === selection.betId);
    return match && bet ? { match, bet, side: selection.side } : null;
  }
  if (referenceVenue !== "Polymarket")
    return null;
  for (const match of matches) {
    for (const bet of match.bets) {
      for (const item of bet.items) {
        if (item.type !== "Polymarket")
          continue;
        if (item.homeId === signal.assetId)
          return { match, bet, side: "Home" };
        if (item.awayId === signal.assetId)
          return { match, bet, side: "Away" };
      }
    }
  }
  return null;
}

/**
 * 只读当前合场与赔率桥，返回触发时快照；基准场馆使用检测器捕获的精确触发价。
 */
export function resolvePmOddsDropVenueSnapshot(
  matches: readonly ViewMatch[],
  signal: PmOddsDropSignal,
  referenceVenue: OddsDropReferenceVenue = "Polymarket",
  selection: OddsDropSelection | null = null,
): PmOddsDropVenueSnapshot | null {
  const located = locateSelection(matches, signal, referenceVenue, selection);
  if (!located)
    return null;
  const { match, bet, side } = located;
  const read = (venue: OddsDropReferenceVenue) => (
    venue === referenceVenue ? signal.currentOdds : readBestVenueOddsForBet(bet, side, venue)
  );
  return {
    matchId: match.id,
    matchTitle: match.title,
    marketTitle: bet.getBetName(),
    side,
    sideLabel: side === "Home" ? (bet.homeName || "主队") : (bet.awayName || "客队"),
    referenceVenue,
    pm: venueQuote(read("Polymarket"), signal.currentOdds),
    ob: venueQuote(read("OB"), signal.currentOdds),
    ray: venueQuote(read("RAY"), signal.currentOdds),
    pb: venueQuote(read("PB"), signal.currentOdds),
  };
}
