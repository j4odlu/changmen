import type { BrowserPmOddsDropSignal } from "./downSettings";
import type { PmOddsDropVenueSnapshot } from "./downVenueSnapshot";
import type { ViewBet, ViewMatch } from "@/models/match";
import { resolvePmOddsDropVenueSnapshot } from "./downVenueSnapshot";

export interface MatchOddsDropSignal {
  signal: BrowserPmOddsDropSignal;
  snapshot: PmOddsDropVenueSnapshot;
}

/** [changmen 扩展] 每个场馆/方向只展示最近一次触发，优先保留触发时快照。 */
export function matchOddsDropSignals(
  match: ViewMatch,
  signals: readonly BrowserPmOddsDropSignal[],
): MatchOddsDropSignal[] {
  const seen = new Set<string>();
  const rows: MatchOddsDropSignal[] = [];
  for (const signal of [...signals].sort((a, b) => b.detectedAt - a.detectedAt)) {
    if (signal.venueSnapshot && signal.venueSnapshot.matchId !== match.id)
      continue;
    if (!signal.venueSnapshot && signal.selection && signal.selection.matchId !== match.id)
      continue;
    const snapshot = signal.venueSnapshot ?? resolvePmOddsDropVenueSnapshot(
      [match], signal, signal.referenceVenue, signal.selection,
    );
    if (!snapshot)
      continue;
    const key = `${signal.referenceVenue}:${signal.assetId}`;
    if (seen.has(key))
      continue;
    seen.add(key);
    rows.push({ signal, snapshot });
  }
  return rows;
}

/** 按合场盘口 ID 归属各地图/全场；不以可能重复的展示标题猜测归属。 */
export function betOddsDropSignals(
  match: ViewMatch,
  bet: ViewBet,
  signals: readonly BrowserPmOddsDropSignal[],
): MatchOddsDropSignal[] {
  return matchOddsDropSignals(match, signals).filter(({ signal, snapshot }) => {
    const betId = snapshot.betId ?? signal.selection?.betId;
    if (betId !== undefined)
      return betId === bet.id;
    return signal.referenceVenue === "Polymarket" && bet.items.some(item => (
      item.type === "Polymarket"
      && (item.homeId === signal.assetId || item.awayId === signal.assetId)
    ));
  });
}
