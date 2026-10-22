import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { ArbBetAttemptParams, ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import type { useLoseOrderStore } from "@/stores/loseOrderStore";
import { isPendingConfirmVenueProvider, isPolymarketProvider } from "@changmen/shared/account_multiply";
import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";
import { LoseOrder } from "@/models/loseOrder";
import { enqueueMakeUpOrder } from "@/stores/betting/autoBet/makeUp";
import { resolveMakeUpSuccessReference } from "@/stores/betting/makeUpReference";

export interface ArbMakeUpPendingContext {
  params: ArbBetAttemptParams;
  placed: ArbBetPlaced;
  rejectA: boolean;
  rejectB: boolean;
  venue: { ordersA: VenueOrder[]; ordersB: VenueOrder[] };
  loseStore: ReturnType<typeof useLoseOrderStore>;
}

/**
 * [changmen 扩展] 提取原待确认原单的队列交接，不直接查单或下注。
 * target：另一腿已成交，原单未成交后补原单腿。
 * anchor：另一腿已失败，原单成交后补另一腿；原单未成交则无敞口结束。
 */
export async function resumeArbMakeUpPending(
  context: ArbMakeUpPendingContext,
  pendingSide: "A" | "B",
  role: "target" | "anchor",
): Promise<boolean> {
  const { match, bet, config, setMessage } = context.params;
  const { legA, legB, accountA, accountB, linkId, resultA, resultB } = context.placed;
  const { rejectA, rejectB, venue, loseStore } = context;
  const pendingResult = pendingSide === "A" ? resultA : resultB;
  const pendingAccount = pendingSide === "A" ? accountA : accountB;
  const pendingLeg = pendingSide === "A" ? legA : legB;
  const otherLeg = pendingSide === "A" ? legB : legA;
  const otherOrders = pendingSide === "A" ? venue.ordersB : venue.ordersA;
  const otherReject = pendingSide === "A" ? rejectB : rejectA;
  const otherAccount = pendingSide === "A" ? accountB : accountA;
  const otherResult = pendingSide === "A" ? resultB : resultA;
  const orderId = String(pendingResult?.orderId ?? "").trim();
  if (!pendingAccount || !orderId)
    return false;
  if (!isPendingConfirmVenueProvider(pendingAccount.provider))
    return false;
  const makeupTargetLeg = role === "target" ? pendingLeg : otherLeg;
  const successLeg = role === "target" ? otherLeg : pendingLeg;
  const successOrders = role === "target"
    ? otherOrders
    : (pendingSide === "A" ? venue.ordersA : venue.ordersB);
  const successRejected = role === "target" ? otherReject : false;
  const successAccount = role === "target" ? otherAccount : pendingAccount;
  const successResult = role === "target" ? otherResult : pendingResult;
  if (!successAccount)
    return false;
  if (loseStore.orders.has(bet.id)) {
    loseStore.setPendingVenueOrder(bet.id, orderId, pendingAccount.accountId, {
      role,
      observation: pendingLeg.observation,
      pendingTarget: pendingLeg.target,
      conditionId: pendingLeg.betId,
      submittedAt: pendingResult?.beginTime,
      pmSubmission: isPolymarketProvider(pendingAccount.provider) ? pmSubmissionFromResult(pendingResult, pendingAccount.accountId) : null,
      odds: pendingLeg.newOdds || pendingLeg.odds,
      betMoney: pendingLeg.betMoney,
      error: isPolymarketProvider(pendingAccount.provider) ? pendingResult?.message || "PM 核验窗口结束，未取得终态" : undefined,
    });
    return true;
  }
  const successRef = resolveMakeUpSuccessReference(
    successLeg,
    successOrders,
    successRejected,
    successAccount,
    successResult?.orderId,
  );
  const enqueued = await enqueueMakeUpOrder({
    loseStore,
    match,
    bet,
    config,
    setMessage,
    linkId,
    accountId: successAccount.accountId,
    target: makeupTargetLeg.target,
    betMoney: successRef.betMoney,
    betOdds: successRef.betOdds,
    failedLegOdds: makeupTargetLeg.odds,
    failedPlatformLabel: `${makeupTargetLeg.type}(待确认续查)`,
    observation: { executionId: successLeg.observation?.executionId, parentAttemptId: successLeg.observation?.attemptId, ownerUserId: successLeg.observation?.ownerUserId, anchorAttemptId: successLeg.observation?.attemptId, anchorOrderId: successResult?.orderId || undefined },
  });
  // delayed 原单必须继续观察，即使补单赔率门槛不允许后续补单。
  if (!enqueued) {
    loseStore.createOrder(new LoseOrder({
      accountId: successAccount.accountId,
      matchId: match.id,
      betId: bet.id,
      target: makeupTargetLeg.target,
      betMoney: successRef.betMoney,
      betOdds: successRef.betOdds,
      match: match.title,
      bet: bet.getBetName(),
      linkId,
      createAt: Date.now(),
      isCreateOrder: false,
      betCount: 1,
    }));
  }
  loseStore.setPendingVenueOrder(bet.id, orderId, pendingAccount.accountId, {
    role,
    observation: pendingLeg.observation,
    pendingTarget: pendingLeg.target,
    conditionId: pendingLeg.betId,
    submittedAt: pendingResult?.beginTime,
    pmSubmission: isPolymarketProvider(pendingAccount.provider) ? pmSubmissionFromResult(pendingResult, pendingAccount.accountId) : null,
    odds: pendingLeg.newOdds || pendingLeg.odds,
    betMoney: pendingLeg.betMoney,
    error: isPolymarketProvider(pendingAccount.provider) ? pendingResult?.message || "PM 核验窗口结束，未取得终态" : undefined,
    makeUpEligible: enqueued,
  });
  return true;
}
