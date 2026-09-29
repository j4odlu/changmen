import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { LoseOrder } from "@/models/loseOrder";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { useLoseOrderStore } from "@/stores/loseOrderStore";
import { BetOption as BetOptionCtor } from "@changmen/client-core/models/betOption";
import { BetResult as BetResultCtor } from "@changmen/client-core/models/betResult";
import { isPendingConfirmVenueProvider, isPolymarketProvider } from "@changmen/shared/account_multiply";
import { isVenueLegConfirmedUnfilled, isVenueLegPendingConfirm, isVenueLegRejected } from "@changmen/venue-adapter/contract";
import { resolveVenueLegOutcome } from "@/domain/betting/resolveVenueLegOutcome";
import { saveVenueSettlementLog } from "@/services/bettingLog";
import { a8Tip } from "@/shared/a8Notify";
import { persistPolymarketExecutionReject } from "@/stores/account/pmRejectOrder";
import { useAccountStore } from "@/stores/accountStore";
import {
  syncActiveBetFail,
  syncActiveBetMakeupDone,
  syncActiveBetMakeupPendingConfirm,
  syncActiveBetMakeupRejected,
} from "@/stores/betting/activeBetRunSync";
import {
  bindArbLegOrder,
  refreshOrderListAfterBind,
  resolveArbBindOrderId,
} from "@/stores/betting/arbOrderBind";
import { enqueuePendingOrderBind } from "@/stores/betting/pendingOrderBind";
import { useMessageStore } from "@/stores/messageStore";
import { useUserStore } from "@/stores/userStore";

export type VenueJbSettlementOutcome
  = | "dequeued"
    | "pending"
    | "rejected"
    | "ready-makeup"
    | "stopped";
/** @deprecated 用 VenueJbSettlementOutcome */
export type PmJbSettlementOutcome = VenueJbSettlementOutcome;

export interface VenueJbSettlementContext {
  betId: number;
  order: LoseOrder;
  account: PlatformAccount;
  result: BetResult;
  checked: BetOption;
  platformLabel: string;
  loseStore: ReturnType<typeof useLoseOrderStore>;
  removeIds: Set<number>;
  setMessage: (msg: string) => void;
}

function isVenueTimeoutReject(result: BetResult): boolean {
  return result.reject === "timeout";
}

/** 受理后确认场馆 jb：订单状态层确认后按 filled / timeout / unfilled 收尾 */
export async function applyVenueJbSettlementOutcome(
  ctx: VenueJbSettlementContext,
): Promise<VenueJbSettlementOutcome> {
  const {
    betId,
    order,
    account,
    result,
    checked,
    platformLabel,
    loseStore,
    removeIds,
    setMessage,
  } = ctx;
  const pendingRole = order.pendingVenueRole ?? "target";
  const makeUpEligible = order.pendingVenueMakeUpEligible !== false;
  const makeUpEnabled = useUserStore().config.makeUp === true;
  const canMakeUp = makeUpEligible && makeUpEnabled;

  const legOutcome = await resolveVenueLegOutcome(
    account,
    result,
    () => useAccountStore().updateVenueOrders(account, {
      pendingBindLinkId: order.linkId || undefined,
      pendingBindOrderId: String(result.orderId ?? "").trim() || undefined,
      waitForOrderId: String(result.orderId ?? "").trim() || undefined,
    }),
    { confirmPostAccepted: true, pmConditionId: String(checked.betId ?? "").trim() || undefined },
  );
  const venueOrders = legOutcome.orders;
  saveVenueSettlementLog({
    account,
    option: checked,
    result,
    orders: venueOrders,
    settlement: legOutcome.settlement,
    linkId: order.linkId,
  });

  if (!isVenueLegRejected(legOutcome)) {
    loseStore.clearPendingVenueOrder(betId);
    const orderId = resolveArbBindOrderId(venueOrders, result, false);
    if (!(await bindArbLegOrder(order.linkId, account, result, venueOrders, false)) && orderId) {
      enqueuePendingOrderBind({
        linkId: order.linkId,
        provider: result.provider,
        accountId: account.accountId,
        orderId,
        betId,
      });
    }
    refreshOrderListAfterBind();
    if (pendingRole === "anchor") {
      if (!canMakeUp) {
        removeIds.add(betId);
        const reason = makeUpEnabled ? "补单条件未通过" : "自动补单已关闭";
        setMessage(`锚腿已成交，${reason}`);
        syncActiveBetFail(betId, `单腿已成交，${reason}`);
        void useAccountStore().refreshBalance(account);
        return "stopped";
      }
      setMessage(`锚腿已成交，开始补 ${order.target}`);
      void useAccountStore().refreshBalance(account);
      return "ready-makeup";
    }
    removeIds.add(betId);
    setMessage(`补单成功 ${platformLabel}@${checked.odds}`);
    syncActiveBetMakeupDone(betId, platformLabel, checked.odds);
    useMessageStore().loseOrderMessage(account, order, checked, false);
    // 确认成交后再刷（不在复检前刷，对齐 A8 jb）；失败不挡出队
    try {
      void useAccountStore().refreshBalance(account);
    }
    catch {
      /* 刷新失败不阻断补单出队 */
    }
    return "dequeued";
  }

  if (
    isVenueLegPendingConfirm(legOutcome) || isVenueTimeoutReject(result)
  ) {
    loseStore.setPendingVenueOrder(betId, String(result.orderId ?? ""), account.accountId, {
      role: pendingRole,
      pendingTarget: order.pendingVenueTarget ?? order.target,
      conditionId: order.pendingVenueConditionId ?? String(checked.betId ?? ""),
      submittedAt: result.beginTime,
      odds: checked.newOdds || checked.odds,
      betMoney: checked.betMoney,
    });
    const isPm = isPolymarketProvider(account.provider);
    // 原单迟到回执不能再被最长 30s 的队列退避拖住；仍由单飞任务控制并发。
    loseStore.deferPendingVenueOrder(betId, isPm ? 1_000 : undefined);
    if (isPm) {
      const firstAlert = !order.pendingVenueError;
      order.pendingVenueError = result.message || "PM 核验窗口结束，未取得成交或取消终态";
      loseStore.persist?.();
      if (firstAlert)
        a8Tip("PM 原单核验超时", "原单仍待确认，继续核对成交结果，禁止重复补单", 10000);
    }
    setMessage(`订单待确认，继续核对 ${String(result.orderId ?? "").slice(0, 10)}…`);
    syncActiveBetMakeupPendingConfirm(betId, result.orderId, order.pendingVenueError);
    useMessageStore().loseOrderMessage(account, order, checked, true);
    return "pending";
  }

  loseStore.clearPendingVenueOrder(betId);
  if (
    isVenueLegConfirmedUnfilled(legOutcome)
    && isPolymarketProvider(account.provider)
  ) {
    try {
      await persistPolymarketExecutionReject(account, result, "unfilled", {
        betOption: checked,
        linkId: order.linkId,
      });
    }
    catch {
      /* 拒单落库失败不阻断补单收尾 */
    }
  }
  const orderId = resolveArbBindOrderId(venueOrders, result, true);
  if (!(await bindArbLegOrder(order.linkId, account, result, venueOrders, true)) && orderId) {
    enqueuePendingOrderBind({
      linkId: order.linkId,
      provider: result.provider,
      accountId: account.accountId,
      orderId,
      betId,
    });
  }
  refreshOrderListAfterBind();
  if (pendingRole === "anchor") {
    removeIds.add(betId);
    setMessage("待确认锚腿未成交，双方均未形成敞口");
    syncActiveBetFail(betId, "待确认订单未成交，补单结束");
    void useAccountStore().refreshBalance(account);
    return "stopped";
  }
  if (!canMakeUp) {
    removeIds.add(betId);
    const reason = makeUpEnabled ? "补单条件未通过" : "自动补单已关闭";
    setMessage(`待确认订单未成交，${reason}`);
    syncActiveBetFail(betId, `另一腿已成交，${reason}`);
    void useAccountStore().refreshBalance(account);
    return "stopped";
  }
  setMessage(`${order.target} 再次被拒单`);
  a8Tip("拒单提醒", `${order.target} 再次被拒单`, 3000);
  syncActiveBetMakeupRejected(betId, order.target);
  useMessageStore().loseOrderMessage(account, order, checked, true);
  // 确认未成交后补刷（资金未扣/已退）；pending 续查不加
  try {
    void useAccountStore().refreshBalance(account);
  }
  catch {
    /* 刷新失败不阻断拒单收尾 */
  }
  return "rejected";
}

/** @deprecated 用 applyVenueJbSettlementOutcome */
export const applyPmJbSettlementOutcome = applyVenueJbSettlementOutcome;

export type VenueJbResumeResult = "not-applicable" | "handled";
/** @deprecated 用 VenueJbResumeResult */
export type PmJbResumeResult = VenueJbResumeResult;

const pendingResumeFlights = new Map<string, Promise<void>>();

export interface PendingVenueResumeParams {
  betId: number;
  order: LoseOrder;
  match?: ViewMatch;
  bet?: ViewBet;
  accountStore: ReturnType<typeof useAccountStore>;
  loseStore: ReturnType<typeof useLoseOrderStore>;
  removeIds: Set<number>;
  setMessage: (msg: string) => void;
  markSuccess: (account: PlatformAccount, target: LoseOrder["target"]) => void;
}

/** 队列项已有 pendingVenueOrderId 时续轮 settle，不再 POST */
export async function tryResumePendingVenueMakeUp(
  params: PendingVenueResumeParams,
): Promise<VenueJbResumeResult> {
  const {
    betId,
    order,
    match,
    bet,
    accountStore,
    loseStore,
    removeIds,
    setMessage,
    markSuccess,
  } = params;

  const pendingId = String(order.pendingVenueOrderId ?? "").trim();
  if (!pendingId)
    return "not-applicable";

  const account = accountStore.findAccount(order.pendingVenueAccountId);
  if (!account || !isPendingConfirmVenueProvider(account.provider)) {
    // [changmen 扩展] 账号消失不是原单未成交证据，保留锁并报告异常。
    order.pendingVenueError = "原单账号不可用，无法核验成交";
    loseStore.deferPendingVenueOrder(betId);
    loseStore.persist?.();
    setMessage(order.pendingVenueError);
    return "handled";
  }

  const pendingRole = order.pendingVenueRole ?? "target";
  const ref = bet?.items.find(item => item.type === account.provider);
  const pendingTarget = order.pendingVenueTarget ?? order.target;
  const sideOdds = order.pendingVenueOdds || ref?.getOdds(pendingTarget) || order.betOdds;
  const pendingStake = order.pendingVenueBetMoney ?? order.getBetMoney(sideOdds);
  const checked = match && bet && ref
    ? new BetOptionCtor(match, bet, ref, pendingTarget, pendingStake)
    : new BetOptionCtor(
        account.provider,
        String(order.matchId),
        order.pendingVenueConditionId ?? String(order.betId),
        "",
        pendingStake,
        pendingTarget,
        sideOdds,
      );
  checked.odds = sideOdds;
  checked.newOdds = sideOdds;
  checked.loseOrder = true;
  checked.diagnosticLinkId = order.linkId;
  checked.diagnosticAttempt = "makeup";

  const result = Object.assign(new BetResultCtor(account.provider, true), {
    orderId: pendingId,
    pending: true,
    beginTime: order.pendingVenueSubmittedAt || order.createAt,
  });

  const outcome = await applyVenueJbSettlementOutcome({
    betId,
    order,
    account,
    result,
    checked,
    platformLabel: ref?.type ?? account.provider,
    loseStore,
    removeIds,
    setMessage,
  });

  if (outcome === "dequeued" && pendingRole === "target")
    markSuccess(account, pendingTarget);
  else if (outcome === "ready-makeup")
    markSuccess(account, pendingTarget);

  return "handled";
}

/** 主循环只负责调度；场馆长轮询在单飞后台任务中执行，不阻塞 A8 编排循环。 */
export function schedulePendingVenueMakeUpResume(
  params: PendingVenueResumeParams,
): VenueJbResumeResult {
  const orderId = String(params.order.pendingVenueOrderId ?? "").trim();
  if (!orderId)
    return "not-applicable";
  if ((Number(params.order.pendingVenueNextPollAt) || 0) > Date.now())
    return "handled";

  const key = `${params.betId}:${orderId}`;
  if (pendingResumeFlights.has(key))
    return "handled";

  const workerRemoveIds = new Set<number>();
  const flight = tryResumePendingVenueMakeUp({
    ...params,
    removeIds: workerRemoveIds,
  })
    .then(() => {
      if (workerRemoveIds.has(params.betId) && params.loseStore.orders.has(params.betId))
        params.loseStore.removeOrder(params.betId, true);
    })
    .catch(() => {
      params.loseStore.deferPendingVenueOrder(params.betId);
    })
    .finally(() => {
      if (pendingResumeFlights.get(key) === flight)
        pendingResumeFlights.delete(key);
    });
  pendingResumeFlights.set(key, flight);
  return "handled";
}

/** @deprecated 用 tryResumePendingVenueMakeUp */
export const tryResumePmPendingMakeUp = tryResumePendingVenueMakeUp;
