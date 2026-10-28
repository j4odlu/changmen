import type {
  OddsDropReferenceVenue,
  OddsDropSelection,
  ReferenceVenueQuote,
  PmOddsDropSnapshotQuote,
} from "./downSettings";
import type { BetSide, ViewBet, ViewMatch } from "@/models/match";

export interface PmOddsDropVenueQuote {
  odds: number;
  evPercent: number;
  /** 触发时最高报价的真实选项；用于 BetRow 定位，不用当前最高价反推历史选项。 */
  itemId?: string;
}

export interface PmOddsDropVenueSnapshot {
  matchId: number;
  /** 触发时的合场盘口；旧内存快照可通过 selection / PM token 定位。 */
  betId?: number;
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
  return readBestVenueSelection(bet, side, type)?.odds ?? 0;
}

function readBestVenueSelection(bet: ViewBet, side: BetSide, type: OddsDropReferenceVenue): { odds: number; itemId: string } | null {
  let best: { odds: number; itemId: string } | null = null;
  for (const item of bet.items) {
    if (item.type !== type || (item.sourceStatus && item.sourceStatus !== "Normal"))
      continue;
    const odds = Number(item.getOdds(side));
    if (Number.isFinite(odds) && odds > 1 && odds > (best?.odds ?? 0))
      best = { odds, itemId: side === "Home" ? item.homeId : item.awayId };
  }
  return best;
}

function venueQuote(odds: number, referenceOdds: number, itemId?: string): PmOddsDropVenueQuote | null {
  if (!(odds > 0))
    return null;
  return {
    odds,
    evPercent: pmVenueEvPercent(odds, referenceOdds),
    itemId,
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
  signal: PmOddsDropSnapshotQuote,
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
  signal: PmOddsDropSnapshotQuote,
  referenceVenue: OddsDropReferenceVenue = "Polymarket",
  selection: OddsDropSelection | null = null,
): PmOddsDropVenueSnapshot | null {
  const located = locateSelection(matches, signal, referenceVenue, selection);
  if (!located)
    return null;
  const { match, bet, side } = located;
  return capturePmOddsDropVenueSnapshot(match, bet, side, signal.currentOdds, referenceVenue);
}

/** 已定位盘口的常数范围捕获，供 PM 行情入队时冻结同侧报价。 */
export function capturePmOddsDropVenueSnapshot(
  match: ViewMatch,
  bet: ViewBet,
  side: BetSide,
  currentOdds: number,
  referenceVenue: OddsDropReferenceVenue,
): PmOddsDropVenueSnapshot {
  const read = (venue: OddsDropReferenceVenue) => {
    const selected = readBestVenueSelection(bet, side, venue);
    return venueQuote(venue === referenceVenue ? currentOdds : selected?.odds ?? 0, currentOdds, selected?.itemId);
  };
  return {
    matchId: match.id,
    betId: bet.id,
    matchTitle: match.title,
    marketTitle: bet.getBetName(),
    side,
    sideLabel: side === "Home" ? (bet.homeName || "主队") : (bet.awayName || "客队"),
    referenceVenue,
    pm: read("Polymarket"),
    ob: read("OB"),
    ray: read("RAY"),
    pb: read("PB"),
  };
}
