// [changmen 扩展] 待确认订单生命周期；与 betGateway 共用单例，保持原有业务时序。
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "@/stores/account/context";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { publishBettingEvent } from "@/realtime/publishBetting";
import { captureBettingEventPayload } from "@/realtime/bettingEventPayload";
import { observeOption } from "@/services/orderObservation";
import { showBetResultNotification } from "@/shared/betNotification";
import { playOrderSuccessSound } from "@/shared/orderSound";
import { persistPolymarketExecutionReject } from "@/stores/account/pmRejectOrder";
import { settleArbLegUntilTerminal } from "@/stores/betting/autoBet/arbLegSettle";
import { markSuccessfulBet } from "@/stores/betting/successMarkers";
import { pmSubmissionFromResult, validatePmSubmission } from "@changmen/shared/pm_submission";
import { pmAccountSubmitAttempts, pmSubmitScope, pmSubmitMaker } from "@changmen/venue-browser/adapter/polymarket";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { getPmSubmission, saveOrders } from "@/api/order";
import { confirmVenueBet } from "@/stores/betting/autoBet/confirmVenueBet";
import { pendingVenueBetConfirmations, pendingVenueConfirmationFlights, pendingVenueConfirmationTimers, pendingVenueConfirmationResumeVersions, pendingVenueOrderWrites, pendingVenueConfirmationSession, pendingVenueAccountMatches, persistPendingVenueBetConfirmations } from "./pendingVenueConfirmationState";
import type { PendingVenueBetConfirmation } from "./pendingVenueConfirmationState";

/** delayed 受理后跟到终态再提示；仍待确认时按原退避策略继续查询。 */
export function notifyPendingVenueConfirm(
  store: AccountStoreContext,
  account: PlatformAccount,
  accountLine: string,
  detailHtml: string,
  result: BetResult,
  option: BetOption,
  toastSeconds: number,
  pendingOrderSave?: Promise<void>,
) {
  const orderId = String(result.orderId ?? "").trim();
  if (!orderId)
    return;
  const pmScope = account.provider === "Polymarket" ? pmSubmitScope(account) : undefined;
  const key = pmScope ? `${pmScope}:${orderId}` : `${account.accountId}:${orderId}`;
  const existing = pendingVenueBetConfirmations.get(key);
  if (existing) {
    if (pendingOrderSave) pendingVenueOrderWrites.set(existing, pendingOrderSave);
    existing.publishData ??= captureBettingEventPayload(option);
    schedulePendingVenueBetConfirmation(store, existing); return;
  }
  const task: PendingVenueBetConfirmation = {
    observation: option.observation,
    linkId: option.diagnosticLinkId,
    key,
    pmScope,
    accountId: account.accountId,
    provider: account.provider,
    orderId,
    matchId: option.matchId,
    venueBetId: option.betId,
    itemId: option.itemId,
    betRowId: Number(option.bet?.id ?? option.betId) || 0,
    target: option.target,
    betMoney: option.betMoney,
    odds: option.odds,
    accountLine,
    detailHtml,
    toastSeconds,
    attempts: 0,
    nextPollAt: Date.now(),
    pmSubmission: account.provider === "Polymarket" ? pmSubmissionFromResult(result, account.accountId) ?? undefined : undefined,
    publishData: captureBettingEventPayload(option),
  };
  if (pendingOrderSave) pendingVenueOrderWrites.set(task, pendingOrderSave);
  pendingVenueBetConfirmations.set(task.key, task);
  persistPendingVenueBetConfirmations();
  void runPendingVenueBetConfirmation(store, task);
}

export function schedulePendingVenueBetConfirmation(
  store: AccountStoreContext,
  task: PendingVenueBetConfirmation,
): void {
  if (pendingVenueConfirmationSession.paused || !pendingVenueAccountMatches(store, task)) return;
  const version = getAuthSessionVersion();
  const existing = pendingVenueConfirmationTimers.get(task.key);
  if (existing && isAuthSessionCurrent(existing.version)) return;
  if (existing) {
    clearTimeout(existing.timer);
    pendingVenueConfirmationTimers.delete(task.key);
  }
  if (pendingVenueConfirmationFlights.has(task.key))
    return;
  const delay = Math.max(0, task.nextPollAt - Date.now());
  const timer = setTimeout(() => {
    pendingVenueConfirmationTimers.delete(task.key);
    if (!isAuthSessionCurrent(version) || pendingVenueConfirmationSession.paused || !pendingVenueAccountMatches(store, task)) return;
    void runPendingVenueBetConfirmation(store, task);
  }, delay);
  pendingVenueConfirmationTimers.set(task.key, { timer, version });
}

async function runPendingVenueBetConfirmation(
  store: AccountStoreContext,
  task: PendingVenueBetConfirmation,
): Promise<void> {
  if (pendingVenueConfirmationSession.paused) return;
  const epoch = pendingVenueConfirmationSession.epoch;
  if (pendingVenueConfirmationFlights.has(task.key))
    return;
  if (task.nextPollAt > Date.now()) {
    schedulePendingVenueBetConfirmation(store, task);
    return;
  }
  const account = store.findAccount(task.accountId);
  if (!account) return;
  // 新任务绑定用户/钱包；旧会话仅在当前钱包的持久化原单能核实时迁移。
  if (task.provider === "Polymarket") {
    try {
      if (account.provider !== "Polymarket") return;
      const scope = pmSubmitScope(account);
      if (!task.pmScope && pmAccountSubmitAttempts(account).some(attempt =>
        attempt.orderHash === task.orderId || attempt.acceptedOrderId === task.orderId)) task.pmScope = scope;
      if (!task.pmScope) {
        // 兼容升级前会话：由服务端校验账号归属，再用原签名 maker 核对当前钱包。
        const version = getAuthSessionVersion();
        let recovered;
        try { recovered = validatePmSubmission(await getPmSubmission(account.accountId, task.orderId), task.orderId, account.accountId); }
        catch {
          if (!isAuthSessionCurrent(version) || epoch !== pendingVenueConfirmationSession.epoch || !pendingVenueAccountMatches(store, task)) return;
          task.nextPollAt = Date.now() + 5_000;
          schedulePendingVenueBetConfirmation(store, task);
          return;
        }
        if (!isAuthSessionCurrent(version) || epoch !== pendingVenueConfirmationSession.epoch || scope !== pmSubmitScope(account)) return;
        if (!recovered?.makerAddress || recovered.makerAddress !== pmSubmitMaker(account)) return;
        task.pmSubmission = recovered;
        task.pmScope = scope;
        persistPendingVenueBetConfirmations();
      }
      if (task.pmScope !== scope) return;
    } catch { return; }
  }
  const sessionVersion = getAuthSessionVersion();

  if (pendingVenueConfirmationFlights.has(task.key)) return;
  pendingVenueConfirmationFlights.add(task.key);
  try {
    const result = Object.assign(new BetResult(task.provider as BetOption["type"], true), {
      success: task.pmSubmission?.submitUnknown !== true,
      pmSubmitUnknown: task.pmSubmission?.submitUnknown,
      pmSubmittedAt: task.pmSubmission?.submittedAt,
      ...(task.pmSubmission ? { beginTime: task.pmSubmission.submittedAt,
        request: { order: { side: "BUY", makerAmount: task.pmSubmission.makerAmount, maker: task.pmSubmission.makerAddress,
          ...(task.pmSubmission.takerAmount ? { takerAmount: task.pmSubmission.takerAmount } : {}) } } } : {}),
      orderId: task.orderId,
      pending: true,
      observation: task.observation,
      link: task.linkId || 0,
    });
    const option = new BetOption(
      task.provider as BetOption["type"],
      task.matchId,
      task.venueBetId,
      task.itemId,
      task.betMoney,
      task.target,
      task.odds,
    );
    option.observation = task.observation;
    option.diagnosticLinkId = task.linkId;
    const { rejected, pendingConfirm, orders } = task.provider === "Polymarket"
      ? await confirmVenueBet(account, result, { rejectWaitSec: 0, pmConditionId: task.venueBetId })
      : await settleArbLegUntilTerminal(account, result, { rejectWaitSec: 0, betOption: option });
    if (!isAuthSessionCurrent(sessionVersion) || epoch !== pendingVenueConfirmationSession.epoch || !pendingVenueAccountMatches(store, task)) return;
    try {
      const exactObservedOrder = orders.find(order => String(order.orderId) === task.orderId);
      observeOption(option, account, "settlement_observed", {
        orderId: task.orderId,
        outcome: pendingConfirm ? "timeout" : rejected ? "unfilled" : "filled",
        source: String(result.message).includes("超时策略判拒") ? "timeout_policy" : exactObservedOrder ? "adapter" : "orchestration_result",
        observedStatus: exactObservedOrder?.status,
        phase: "reject_detection",
      });
    }
    catch { /* 观察快照异常不改变原单确认的后续处理 */ }
    if (pendingConfirm) {
      task.pmSubmission = pmSubmissionFromResult(result, account.accountId) ?? task.pmSubmission;
      task.attempts += 1;
      task.nextPollAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(task.attempts - 1, 5));
      pendingVenueBetConfirmations.set(task.key, task);
      persistPendingVenueBetConfirmations();
      return;
    }

    if (task.provider === "Polymarket") {
      await pendingVenueOrderWrites.get(task);
      if (!isAuthSessionCurrent(sessionVersion) || epoch !== pendingVenueConfirmationSession.epoch || !pendingVenueAccountMatches(store, task)) return;
      pendingVenueOrderWrites.delete(task);
      if (rejected) {
        const saved = await persistPolymarketExecutionReject(account, result, "unfilled", { linkId: task.linkId });
        if (!saved) throw new Error("PM 拒单结果保存失败");
      }
      else {
        const filled = orders.find(order => String(order.orderId) === task.orderId
          && !["pending", "reject"].includes(order.status) && Number(order.pmShares) > 0);
        // 成交明细尚未索引或保存失败：保留任务，续查/保存同一单号。
        if (!filled) throw new Error("PM 成交明细尚未同步");
        await saveOrders(account, [filled]);
      }
    }
    if (!isAuthSessionCurrent(sessionVersion) || epoch !== pendingVenueConfirmationSession.epoch || !pendingVenueAccountMatches(store, task)) return;
    pendingVenueBetConfirmations.delete(task.key);
    pendingVenueConfirmationResumeVersions.delete(task.key);
    persistPendingVenueBetConfirmations();
    const titleSuffix = rejected ? "未成交" : "已成交";
    showBetResultNotification({ provider: account.provider, accountLine: task.accountLine, detailHtml: task.detailHtml }, {
      messageHtml: `<p>${result.message || ""}</p>`,
      statusSuffix: titleSuffix,
      type: rejected ? "error" : "success",
    }, task.toastSeconds);
    if (!rejected && !task.recoveryOnly) {
      try { void playOrderSuccessSound({ betRowId: task.betRowId || task.venueBetId }).catch(() => {}); }
      catch { /* 音效失败不阻断成交计数。 */ }
      try { void publishBettingEvent(task.publishData ?? option).catch(() => {}); }
      catch { /* 广播失败不阻断成交计数。 */ }
      // PF/PM：受理≠成交；成功计数推迟到 filled
      if (isPendingConfirmVenueProvider(account.provider)) {
        const betRowId = Number(task.betRowId);
        if (Number.isFinite(betRowId) && betRowId > 0)
          markSuccessfulBet(account, betRowId, option.target, option.odds);
      }
    }
    if (isPendingConfirmVenueProvider(account.provider)) {
      try {
        const { refreshAccountBalance } = await import("@/stores/account/balanceRefresh");
        await refreshAccountBalance(store, account);
      }
      catch {
        /* 刷新失败不阻断 toast */
      }
      try {
        const { refreshOrderListAfterBind } = await import("@/stores/betting/arbOrderBind");
        refreshOrderListAfterBind();
      }
      catch {
        /* 侧栏刷新失败不阻断 toast */
      }
    }
  }
  catch {
    if (epoch === pendingVenueConfirmationSession.epoch && pendingVenueBetConfirmations.has(task.key)) {
      task.attempts += 1;
      task.nextPollAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(task.attempts - 1, 5));
      pendingVenueBetConfirmations.set(task.key, task);
      persistPendingVenueBetConfirmations();
    }
  }
  finally {
    pendingVenueConfirmationFlights.delete(task.key);
    const current = pendingVenueBetConfirmations.get(task.key);
    const resumedVersion = pendingVenueConfirmationResumeVersions.get(task.key);
    if (current && !pendingVenueConfirmationSession.paused && pendingVenueAccountMatches(store, task)
      && (epoch === pendingVenueConfirmationSession.epoch && isAuthSessionCurrent(sessionVersion) || resumedVersion != null && isAuthSessionCurrent(resumedVersion)))
      schedulePendingVenueBetConfirmation(store, current);
  }
}
