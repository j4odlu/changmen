import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import type { A8BetsMessage } from "../shared/socket/accumulator";
import { PLATFORMS } from "../shared/platforms";

/**
 * 对齐 A8 `LHe`：频道 Stake 只写 fo；`isLock` 恒 false（锁盘靠赔率清零）。
 */
export function applyStakeLiveOdds(message: A8BetsMessage | undefined | null): number {
  let written = 0;
  const bets = message?.bets;
  if (!bets?.length) return 0;
  const now = Date.now();
  for (const bet of bets) {
    const homeId = String(bet.homeId ?? "");
    const awayId = String(bet.awayId ?? "");
    if (!homeId || !awayId) continue;
    const betId = String(bet.betId ?? "");
    saveVenueOdds(
      PLATFORMS.Stake,
      { id: homeId, odds: Number(bet.home) || 0, isLock: false, betId, time: now },
      "mqtt",
    );
    saveVenueOdds(
      PLATFORMS.Stake,
      { id: awayId, odds: Number(bet.away) || 0, isLock: false, betId, time: now },
      "mqtt",
    );
    written += 2;
  }
  return written;
}
