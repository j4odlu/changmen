import type { BetSide, ViewBet } from "@/models/match";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import type { ArbLegSettleSnapshot } from "@/stores/betting/autoBet/phases/settleBothArbLegs";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";

/**
 * 场馆未拒单的成功腿写入 BETACCOUNT / BETCOUNT。
 * PF/PM：受理≠成交，仍 pendingConfirm 时不记，等 filled 后再记。
 * 其它馆：对齐 A8，不看 pendingConfirm。
 */
export function markArbSuccessLegs(
  bet: ViewBet,
  placed: ArbBetPlaced,
  settle: ArbLegSettleSnapshot,
): void {
  const { legA, legB, accountA, accountB, resultA, resultB } = placed;
  const markLeg = (
    leg: BetOption,
    result: typeof resultA,
    account: typeof accountA,
    reject: boolean,
    pendingConfirm: boolean,
    target: BetSide,
    odds: number,
  ) => {
    const execution = placed.originalExecution?.legs.get(leg);
    if (execution) { execution.markConfirmed(); return; }
    if (!result?.success || reject || !account)
      return;
    if (isPendingConfirmVenueProvider(account.provider) && pendingConfirm)
      return;
    markSuccessfulBet(account, bet.id, target, odds);
  };
  markLeg(legA, resultA, accountA, settle.rejectA, settle.pendingConfirmA, legA.target, legA.odds);
  markLeg(legB, resultB, accountB, settle.rejectB, settle.pendingConfirmB, legB.target, legB.odds);
}
