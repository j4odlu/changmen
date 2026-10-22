import type { BetOption } from "@changmen/client-core/models/betOption";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbMakeUpEnqueueResult, ArbMakeUpVenueContext } from "@/stores/betting/autoBet/arbMakeUpFromRejects";
import type { ArbBetAttemptParams, ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import type { useLoseOrderStore } from "@/stores/loseOrderStore";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { enqueueMakeUpOrder } from "@/stores/betting/autoBet/makeUp";
import { resolveMakeUpSuccessReference } from "@/stores/betting/makeUpReference";

/** [A8 可证实] LoseOrder 用成功腿 option 的 betMoney/odds，不用场馆实单 */
function a8SuccessLegRef(leg: BetOption): { betMoney: number; betOdds: number } {
  return {
    betMoney: Math.round(Number(leg.betMoney) || 0),
    betOdds: Number(leg.odds) || 0,
  };
}

/** 成功腿锚点的唯一解析口径；旁路延迟拒单也复用，避免产生第二套补单计算。 */
export function resolveArbMakeUpSuccessRef(
  leg: BetOption,
  orders: VenueOrder[],
  rejected: boolean,
  account?: PlatformAccount,
  orderId?: string | null,
): { betMoney: number; betOdds: number } {
  if (account && isPendingConfirmVenueProvider(account.provider))
    return resolveMakeUpSuccessReference(leg, orders, rejected, account, orderId);
  return a8SuccessLegRef(leg);
}

export interface ArbMakeUpEnqueueContext {
  params: ArbBetAttemptParams;
  placed: ArbBetPlaced;
  rejectA: boolean;
  rejectB: boolean;
  venue: ArbMakeUpVenueContext;
  loseStore: ReturnType<typeof useLoseOrderStore>;
}

/** [changmen 扩展] 执行已决定的正常补单入队；保留原成功腿参考值和两侧入队分支，不查单或下注。 */
export async function enqueueArbMakeUpSide(
  context: ArbMakeUpEnqueueContext,
  side: "A" | "B",
): Promise<ArbMakeUpEnqueueResult> {
  const { match, bet, config, setMessage } = context.params;
  const { legA, legB, accountA, accountB, linkId, resultA, resultB } = context.placed;
  const { rejectA, rejectB, venue, loseStore } = context;
  const result: ArbMakeUpEnqueueResult = {
    enqueuedForLegA: false,
    enqueuedForLegB: false,
  };

  if (side === "B" && accountA) {
    const successRef = resolveArbMakeUpSuccessRef(
      legA,
      venue.ordersA,
      rejectA,
      accountA,
      resultA?.orderId,
    );
    result.enqueuedForLegB = await enqueueMakeUpOrder({
      loseStore,
      match,
      bet,
      config,
      setMessage,
      linkId,
      accountId: accountA.accountId,
      target: legB.target,
      betMoney: successRef.betMoney,
      betOdds: successRef.betOdds,
      failedLegOdds: legB.odds,
      failedPlatformLabel: legB.type,
      observation: { executionId: legA.observation?.executionId, parentAttemptId: legA.observation?.attemptId, ownerUserId: legA.observation?.ownerUserId, anchorAttemptId: legA.observation?.attemptId, anchorOrderId: resultA?.orderId || undefined },
    });
  }
  else if (side === "A" && accountB) {
    const successRef = resolveArbMakeUpSuccessRef(
      legB,
      venue.ordersB,
      rejectB,
      accountB,
      resultB?.orderId,
    );
    result.enqueuedForLegA = await enqueueMakeUpOrder({
      loseStore,
      match,
      bet,
      config,
      setMessage,
      linkId,
      accountId: accountB.accountId,
      target: legA.target,
      betMoney: successRef.betMoney,
      betOdds: successRef.betOdds,
      failedLegOdds: legA.odds,
      failedPlatformLabel: legA.type,
      observation: { executionId: legB.observation?.executionId, parentAttemptId: legB.observation?.attemptId, ownerUserId: legB.observation?.ownerUserId, anchorAttemptId: legB.observation?.attemptId, anchorOrderId: resultB?.orderId || undefined },
    });
  }

  return result;
}
