import type { BetOption } from "@changmen/client-core/models/betOption";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbBetAttemptParams, ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { LoseOrder } from "@/models/loseOrder";
import { arbMakeUpSides } from "@/stores/betting/autoBet/arbMakeUpPair";
import { enqueueMakeUpOrder } from "@/stores/betting/autoBet/makeUp";
import { resolveMakeUpSuccessReference } from "@/stores/betting/makeUpReference";
import { useLoseOrderStore } from "@/stores/loseOrderStore";

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

export interface ArbMakeUpVenueContext {
  ordersA: VenueOrder[];
  ordersB: VenueOrder[];
}

export interface ArbMakeUpEnqueueResult {
  enqueuedForLegA: boolean;
  enqueuedForLegB: boolean;
}

export interface ArbMakeUpPendingConfirm {
  pendingConfirmA?: boolean;
  pendingConfirmB?: boolean;
}

/** 编排层判定需补单后入队（不看 makeUp 开关）；赔率/初赔阈值在 enqueue 内按败腿价走 A8 `B()` */
export async function applyArbMakeUpFromRejects(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
  rejectA: boolean,
  rejectB: boolean,
  venue: ArbMakeUpVenueContext = { ordersA: [], ordersB: [] },
  pending: ArbMakeUpPendingConfirm = {},
): Promise<ArbMakeUpEnqueueResult> {
  const { match, bet, config, setMessage } = params;
  // [A8 可证实] 入队不看 makeUp；消费段 `orders && config.makeUp` 才 jb
  const loseStore = useLoseOrderStore();
  const {
    legA,
    legB,
    accountA,
    accountB,
    betBothLegs,
    linkId,
    resultA,
    resultB,
  } = placed;
  const result: ArbMakeUpEnqueueResult = {
    enqueuedForLegA: false,
    enqueuedForLegB: false,
  };

  if (!betBothLegs)
    return result;

  const pendingConfirmA = Boolean(pending.pendingConfirmA);
  const pendingConfirmB = Boolean(pending.pendingConfirmB);

  // pending target：另一腿已成交，pending 未成交后补 pending 腿。
  // pending anchor：另一腿已失败，pending 成交后补另一腿；pending 未成交则无敞口结束。
  const resumePending = async (
    pendingSide: "A" | "B",
    role: "target" | "anchor",
  ): Promise<boolean> => {
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
        pendingTarget: pendingLeg.target,
        conditionId: pendingLeg.betId,
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
      pendingTarget: pendingLeg.target,
      conditionId: pendingLeg.betId,
      makeUpEligible: enqueued,
    });
    return true;
  };

  if (pendingConfirmA && !pendingConfirmB) {
    const role = resultB?.success && !rejectB ? "target" : "anchor";
    const queued = await resumePending("A", role);
    if (role === "target")
      result.enqueuedForLegA = queued;
    else
      result.enqueuedForLegB = queued;
    return result;
  }
  if (pendingConfirmB && !pendingConfirmA) {
    const role = resultA?.success && !rejectA ? "target" : "anchor";
    const queued = await resumePending("B", role);
    if (role === "target")
      result.enqueuedForLegB = queued;
    else
      result.enqueuedForLegA = queued;
    return result;
  }

  const side = arbMakeUpSides(
    resultA,
    rejectA,
    resultB,
    rejectB,
    pendingConfirmA,
    pendingConfirmB,
  );

  if (side === "enqueueB" && accountA) {
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
    });
  }
  else if (side === "enqueueA" && accountB) {
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
    });
  }

  return result;
}
