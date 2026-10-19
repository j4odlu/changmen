import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { LoseOrder } from "@/models/loseOrder";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { useLoseOrderStore } from "@/stores/loseOrderStore";
import { BetOption as BetOptionCtor } from "@changmen/client-core/models/betOption";
import { BetResult as BetResultCtor } from "@changmen/client-core/models/betResult";
import { isPendingConfirmVenueProvider, isPolymarketProvider } from "@changmen/shared/account_multiply";
import { pmSubmissionFromResult, validatePmSubmission } from "@changmen/shared/pm_submission";
import { isVenueLegConfirmedUnfilled, isVenueLegPendingConfirm, isVenueLegRejected } from "@changmen/venue-browser/adapter/contract";
import { getPmSubmission } from "@/api/order";
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
  bindArbOrderId,
  refreshOrderListAfterBind,
  resolveArbBindOrderId,
} from "@/stores/betting/arbOrderBind";
import { enqueuePendingOrderBind } from "@/stores/betting/pendingOrderBind";
import { useMessageStore } from "@/stores/messageStore";
import { useUserStore } from "@/stores/userStore";
import { consumeMakeUpQueue } from "@/stores/loseOrderStore";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import {
  continueMakeUpObservation,
  isMakeUpObservationRetrying,
  makeUpObservationScope,
  processA8RegularVenueMakeUpLeg,
} from "@/stores/betting/loseOrderRegular";

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
  markSuccess?: (account: PlatformAccount, target: LoseOrder["target"]) => void;
}

function isVenueTimeoutReject(result: BetResult): boolean {
  return result.reject === "timeout";
}

const countedResults = new WeakSet<BetResult>();

/** [changmen 扩展] 取消队列只停止新下注；已发送的原单仍核验并绑定，不写回新队列。 */
function continueDetachedObservation(ctx: VenueJbSettlementContext, scopeCurrent: () => boolean): void {
  continueMakeUpObservation(ctx.order, scopeCurrent,
    async () => (await applyVenueJbSettlementOutcome(ctx)) === "pending");
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
  const pendingTarget = order.pendingVenueTarget ?? order.target;
  const makeUpEligible = order.pendingVenueMakeUpEligible !== false;
  const makeUpEnabled = useUserStore().config.makeUp === true;
  const canMakeUp = makeUpEligible && makeUpEnabled;
  const pendingId = order.pendingVenueOrderId;
  // [changmen 扩展] 异步结果只归属于发起检测的队列和原单。
  const isCurrentOrder = () => loseStore.orders.get(betId) === order
    && order.pendingVenueOrderId === pendingId;
  // [A8 可证实] 受理的补单检测结束后计数；[changmen 扩展] 计数属于原单，不依赖队列存续。
  const recordTerminal = (filled: boolean) => {
    if (countedResults.has(result) || (!filled && pendingRole !== "target"))
      return;
    countedResults.add(result);
    try {
      if (ctx.markSuccess)
        ctx.markSuccess(account, pendingTarget);
      else
        markSuccessfulBet(account, betId, pendingTarget);
    }
    catch { /* 计数存储失败不改变成交事实或重新开放原补单。 */ }
  };

  const scopeCurrent = makeUpObservationScope(account);
  const savedReceipt = order.pendingVenueReceipt;
  const receipt = savedReceipt?.orderId === String(result.orderId ?? "").trim()
    && savedReceipt.accountId === account.accountId ? savedReceipt : undefined;
  let legOutcome: Awaited<ReturnType<typeof resolveVenueLegOutcome>>;
  try {
    if (receipt) {
      // [changmen 扩展] 已确定结果先于绑定保存；恢复后只收尾，不能被后续超时或新查询改判。
      result.success = true;
      result.pending = false;
      result.pmSubmitUnknown = false;
      result.reject = receipt.rejected ? "unfilled" : null;
      result.message = receipt.message ?? result.message;
      legOutcome = { orders: [], settlement: receipt.rejected ? "unfilled" : "filled" };
    }
    else {
      legOutcome = await resolveVenueLegOutcome(
        account,
        result,
        () => useAccountStore().updateVenueOrders(account, {
          pendingBindLinkId: order.linkId || undefined,
          pendingBindOrderId: String(result.orderId ?? "").trim() || undefined,
          waitForOrderId: String(result.orderId ?? "").trim() || undefined,
        }),
        { confirmPostAccepted: true, pmConditionId: String(checked.betId ?? "").trim() || undefined },
      );
    }
  }
  catch {
    continueDetachedObservation(ctx, scopeCurrent);
    return "pending";
  }
  if (isMakeUpObservationRetrying(order) && !scopeCurrent())
    return "stopped";
  const venueOrders = legOutcome.orders;
  if (!receipt && order.pendingVenueOrderId === pendingId
    && !isVenueLegPendingConfirm(legOutcome) && !isVenueTimeoutReject(result)) {
    order.pendingVenueReceipt = {
      orderId: String(result.orderId ?? "").trim(), accountId: account.accountId,
      rejected: isVenueLegRejected(legOutcome),
      bindOrderId: resolveArbBindOrderId(venueOrders, result, isVenueLegRejected(legOutcome)),
      message: result.message ?? undefined,
    };
    if (isCurrentOrder()) {
      try { loseStore.persist(); }
      catch { /* 本页保留终态；存储失败不能改判或重发已确认原单。 */ }
    }
  }
  try {
    saveVenueSettlementLog({
      account,
      option: checked,
      result,
      orders: venueOrders,
      settlement: legOutcome.settlement,
      linkId: order.linkId,
    });
  }
  catch { /* 诊断异常不能改变已经确定的场馆结果。 */ }

  if (!isVenueLegRejected(legOutcome)) {
    const orderId = receipt ? receipt.bindOrderId : resolveArbBindOrderId(venueOrders, result, false);
    const bound = receipt
      ? orderId ? await bindArbOrderId(order.linkId, result.provider, account.accountId, orderId) : false
      : await bindArbLegOrder(order.linkId, account, result, venueOrders, false);
    if (!bound && orderId) {
      enqueuePendingOrderBind({
        observation: result.observation,
        target: checked.target,
        linkId: order.linkId,
        provider: result.provider,
        accountId: account.accountId,
        orderId,
        betId,
      });
    }
    const currentAtCommit = isCurrentOrder();
    try {
      if (currentAtCommit) {
        if (pendingRole !== "anchor" || !canMakeUp)
          consumeMakeUpQueue(loseStore, order, removeIds);
        else
          loseStore.clearPendingVenueOrder(betId);
      }
    }
    finally {
      recordTerminal(true);
    }
    const current = loseStore.orders.get(betId);
    if (!currentAtCommit || (current && current !== order))
      return "stopped";
    refreshOrderListAfterBind();
    if (pendingRole === "anchor") {
      if (!canMakeUp) {
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
    if (!isCurrentOrder()) {
      continueDetachedObservation(ctx, scopeCurrent);
      return "pending";
    }
    loseStore.setPendingVenueOrder(betId, String(result.orderId ?? ""), account.accountId, {
      role: pendingRole,
      observation: checked.observation,
      pendingTarget: order.pendingVenueTarget ?? order.target,
      conditionId: order.pendingVenueConditionId ?? String(checked.betId ?? ""),
      submittedAt: result.beginTime,
      pmSubmission: isPolymarketProvider(account.provider) ? pmSubmissionFromResult(result, account.accountId) : null,
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
  const orderId = receipt ? receipt.bindOrderId : resolveArbBindOrderId(venueOrders, result, true);
  const bound = receipt
    ? orderId ? await bindArbOrderId(order.linkId, result.provider, account.accountId, orderId) : false
    : await bindArbLegOrder(order.linkId, account, result, venueOrders, true);
  if (!bound && orderId) {
    enqueuePendingOrderBind({
      observation: result.observation,
      target: checked.target,
      linkId: order.linkId,
      provider: result.provider,
      accountId: account.accountId,
      orderId,
      betId,
    });
  }
  const currentAtCommit = isCurrentOrder();
  try {
    if (currentAtCommit) {
      if (pendingRole === "anchor" || !canMakeUp)
        consumeMakeUpQueue(loseStore, order, removeIds);
      else
        loseStore.clearPendingVenueOrder(betId);
    }
  }
  finally {
    recordTerminal(false);
  }
  const current = loseStore.orders.get(betId);
  if (!currentAtCommit || (current && current !== order))
    return "stopped";
  refreshOrderListAfterBind();
  if (pendingRole === "anchor") {
    setMessage("待确认锚腿未成交，双方均未形成敞口");
    syncActiveBetFail(betId, "待确认订单未成交，补单结束");
    void useAccountStore().refreshBalance(account);
    return "stopped";
  }
  if (!canMakeUp) {
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

const pendingResumeFlights = new WeakSet<LoseOrder>();

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
  if (!pendingId && !order.pendingRegularReceipt)
    return "not-applicable";
  const isCurrentOrder = () => loseStore.orders.get(betId) === order
    && String(order.pendingVenueOrderId ?? "").trim() === pendingId;

  const account = accountStore.findAccount(order.pendingVenueAccountId);
  if (!account || (!order.pendingRegularReceipt && !isPendingConfirmVenueProvider(account.provider))) {
    if (!isCurrentOrder())
      return "handled";
    // [changmen 扩展] 账号消失不是原单未成交证据，保留锁并报告异常。
    order.pendingVenueError = "原单账号不可用，无法核验成交";
    loseStore.deferPendingVenueOrder(betId);
    loseStore.persist?.();
    setMessage(order.pendingVenueError);
    return "handled";
  }

  const ref = bet?.items.find(item => item.type === account.provider);
  const pendingTarget = order.pendingVenueTarget ?? order.target;
  const isPm = isPolymarketProvider(account.provider);
  let submission = validatePmSubmission(order.pendingPmSubmission, pendingId, account.accountId);
  if (isPm && !submission) {
    try {
      submission = validatePmSubmission(await getPmSubmission(account.accountId, pendingId), pendingId, account.accountId);
    }
    catch { /* 金额恢复失败不阻断原单状态核验，也不得触发新 POST。 */ }
    if (submission) {
      order.pendingPmSubmission = submission;
      order.pendingVenueBetMoney = submission.stakeUsdc;
      order.pendingVenueSubmittedAt = submission.submittedAt;
      if (isCurrentOrder())
        loseStore.persist?.();
    }
    else {
      if (!isCurrentOrder())
        return "handled";
      // 保留原单锁和队列以便恢复读取；不制造订单、不触发另一笔 POST。
      order.pendingVenueError = "原单记录读取失败，正在重试";
      loseStore.deferPendingVenueOrder(betId);
      loseStore.persist?.();
      setMessage(order.pendingVenueError);
      return "handled";
    }
  }
  // [changmen 扩展] PM 续查只能使用原单 USDC；旧队列的人民币计划额不可作为兜底。
  const sideOdds = isPm ? order.pendingVenueOdds || 0 : order.pendingVenueOdds || ref?.getOdds(pendingTarget) || order.betOdds;
  const pendingStake = isPm ? submission!.stakeUsdc : order.pendingVenueBetMoney ?? order.getBetMoney(sideOdds);
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
  checked.observation = order.pendingObservation;

  const result = Object.assign(new BetResultCtor(account.provider, true), {
    success: submission?.submitUnknown !== true,
    pmSubmitUnknown: submission?.submitUnknown,
    pmSubmittedAt: submission?.submittedAt,
    orderId: pendingId,
    pending: isPendingConfirmVenueProvider(account.provider),
    observation: order.pendingObservation,
    beginTime: submission?.submittedAt || order.pendingVenueSubmittedAt || order.createAt,
    ...(submission ? { request: { order: { side: "BUY", makerAmount: submission.makerAmount,
      ...(submission.takerAmount ? { takerAmount: submission.takerAmount } : {}) } } } : {}),
  });

  if (order.pendingRegularReceipt) {
    await processA8RegularVenueMakeUpLeg({
      betId, order, bet: { id: betId }, account, checked, result, accountStore,
      waitSec: Math.max(0, (order.pendingRegularReceipt.checkAt - Date.now()) / 1000),
      removeIds, setMessage, resumeAccepted: true,
    });
    return "handled";
  }

  await applyVenueJbSettlementOutcome({
    betId,
    order,
    account,
    result,
    checked,
    platformLabel: ref?.type ?? account.provider,
    loseStore,
    removeIds,
    setMessage,
    markSuccess,
  });

  return "handled";
}

/** 主循环只负责调度；场馆长轮询在单飞后台任务中执行，不阻塞 A8 编排循环。 */
export function schedulePendingVenueMakeUpResume(
  params: PendingVenueResumeParams,
): VenueJbResumeResult {
  // [changmen 扩展] 覆盖解除 pending 到队列出队之间的微任务间隙；新队列不继承旧任务。
  if (pendingResumeFlights.has(params.order) || isMakeUpObservationRetrying(params.order))
    return "handled";
  const orderId = String(params.order.pendingVenueOrderId ?? "").trim();
  if (!orderId && !params.order.pendingRegularReceipt)
    return "not-applicable";
  if ((Number(params.order.pendingVenueNextPollAt) || 0) > Date.now())
    return "handled";

  const isCurrentOrder = () => params.loseStore.orders.get(params.betId) === params.order;
  const workerRemoveIds = new Set<number>();
  pendingResumeFlights.add(params.order);
  void tryResumePendingVenueMakeUp({
    ...params,
    removeIds: workerRemoveIds,
  })
    .catch(() => {
      if (isCurrentOrder() && String(params.order.pendingVenueOrderId ?? "").trim() === orderId)
        params.loseStore.deferPendingVenueOrder(params.betId);
    })
    .finally(() => {
      pendingResumeFlights.delete(params.order);
    })
    .catch(() => { /* 持久化失败时内存中的出队仍有效，不能重开已成交的队列。 */ });
  return "handled";
}

/** @deprecated 用 tryResumePendingVenueMakeUp */
export const tryResumePmPendingMakeUp = tryResumePendingVenueMakeUp;
