import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import { passesDefaultOddsAt } from "@/domain/betting/betFilters";
import { isSingleLegRateAtOdds } from "@/domain/betting/singleLegRate";
import { useMatchStore } from "@/stores/matchStore";
import { assertGtcHistoryAllowsLeg } from "./successMarkers";

export function gtcAccountAllows(account: PlatformAccount, leg: BetOption, bet: ViewBet, match: ViewMatch, owner: string, noSameBet: boolean, manual = false): boolean {
  const matches = useMatchStore();
  // [changmen 扩展] 手动下单跳过账号最低/最高赔率；自动下单仍检查。
  if (account.isPause() || account.markupOnly || (!manual && !account.checkOdds(leg.odds, match.gameId))
    || !passesDefaultOddsAt(account, matches.getDefaultOdds?.(bet.id, leg.target))) {
    return false;
  }
  const target = matches.getBetTarget(account.provider, bet.id);
  if (target && target !== leg.target)
    return false;
  // Each manual order is an explicit user decision; historical counts do not limit it.
  if (manual)
    return true;
  if (isSingleLegRateAtOdds(account, leg.odds))
    return false;
  try {
    assertGtcHistoryAllowsLeg(owner, account, bet.id, leg.target, leg.odds, noSameBet);
    return true;
  }
  catch { return false; }
}
