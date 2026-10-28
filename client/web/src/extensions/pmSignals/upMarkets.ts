import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { PmUpMarket } from "./upDetector";

interface Location { match: ViewMatch; bet: ViewBet; pm: ViewBetItem; side: BetSide; key: string }

export function indexPmUpMarkets(matches: readonly ViewMatch[]): Map<string, Location[]> {
  const index = new Map<string, Location[]>();
  for (const match of matches) {
    for (const bet of match.bets) {
      for (const pm of bet.items) {
        if (pm.type !== "Polymarket") continue;
        for (const side of ["Home", "Away"] as const) {
          const assetId = side === "Home" ? pm.homeId : pm.awayId;
          if (!assetId) continue;
          const locations = index.get(assetId) ?? [];
          locations.push({ match, bet, pm, side, key: `${match.id}:${bet.id}:${side}:${assetId}` });
          index.set(assetId, locations);
        }
      }
    }
  }
  return index;
}

function isOpen(item: ViewBetItem): boolean {
  return !item.sourceStatus || item.sourceStatus === "Normal";
}

/** 只读取同一合场盘口的对侧；每个场馆保留最高的有效赔率，不依赖账号或套利开关。 */
export function snapshotPmUpMarket(location: Location, assetId: string): PmUpMarket | null {
  const { match, bet, pm, side, key } = location;
  if (!isOpen(pm)) return null;
  const targetSide = side === "Home" ? "Away" : "Home";
  const targets = new Map<string, PmUpMarket["targets"][number]>();
  for (const item of bet.items) {
    if (item.type === "Polymarket" || !isOpen(item)) continue;
    const odds = Number(item.getOdds(targetSide));
    const itemId = targetSide === "Home" ? item.homeId : item.awayId;
    if (!itemId || !Number.isFinite(odds) || odds <= 1) continue;
    if (odds <= (targets.get(item.type)?.odds ?? 0)) continue;
    targets.set(item.type, { provider: item.type, itemId, odds });
  }
  const label = (s: BetSide) => s === "Home" ? (bet.homeName || "主队") : (bet.awayName || "客队");
  return {
    key, assetId, matchId: match.id, betId: bet.id,
    matchTitle: match.title, marketTitle: bet.getBetName(),
    pmSide: side, pmSideLabel: label(side), targetSide, targetSideLabel: label(targetSide),
    targets: [...targets.values()],
  };
}
