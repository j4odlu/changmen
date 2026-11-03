import type { ViewMatch } from "@changmen/client-core/models/match";
import { isPmMapLive } from "@/shared/pmSportDisplay";

/** 当前地图只沿用 PM LIVE 的判定，不根据赔率或 OB 进度猜测。 */
export function resolveTrendTarget(match: ViewMatch) {
  const bet = match.bets.find(bet => !bet.marketCode && isPmMapLive(match.pmSport, bet.round)
    && bet.items.some(item => item.type === "Polymarket" && item.homeId && item.awayId));
  const pm = bet?.items.find(item => item.type === "Polymarket" && item.homeId && item.awayId);
  if (!bet || !pm) return null;
  return {
    key: JSON.stringify([match.id, bet.id, bet.round, pm.homeId, pm.awayId]),
    round: bet.round,
    homeId: pm.homeId, awayId: pm.awayId,
    homeName: bet.homeName || "主队", awayName: bet.awayName || "客队",
  };
}
