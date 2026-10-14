import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { OriginalExecutionLifecycle } from "@/domain/betting/originalLegExecution";
import type { ArbBetAttemptParams, ArbBetChecked } from "@/stores/betting/autoBet/phases/types";
import { BetResult } from "@changmen/client-core/models/betResult";
import { getExchange, resolveAccountCurrency } from "@changmen/shared/currency";
import { gtcStateLabel } from "@changmen/shared/pm_gtc";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { notifyBet } from "@/shared/betNotification";
import { createGtc } from "./api";
import { prepareOtherLeg } from "./gateway";
import { findGtcOtherOrder } from "./otherFacts";
import { settleGtcOtherLeg } from "./otherOrders";
import { gtcExecutionResult } from "./result";
import { gtcPmNotice } from "./notifications";
import { acceptGtc, beginGtcInitialDispatch, currentGtc, markGtcLegOnce, mutateGtc, pollGtc, refreshGtcRecords, startGtcRuntime } from "./runtime";
import { assertGtcHistoryAllowsLeg } from "./successMarkers";
import { gtcProgress } from "./gtcProgressState";

/** [changmen 扩展] 旧持久化双腿身份的兼容桥；只提供单腿操作，不编排 prepare/place/settle/finalize。 */
export async function prepareGtcLegExecution(params: ArbBetAttemptParams, checked: ArbBetChecked): Promise<OriginalExecutionLifecycle> {
  if (!checked.betBothLegs || checked.singleLegByRate || !checked.accountA || !checked.accountB
    || [checked.legA.type, checked.legB.type].filter(type => type === "Polymarket").length !== 1)
    throw new Error("GTC V1 仅支持一条 PM 腿的双边自动套利");
  const user = useUserStore(); const owner = String(user.userId);
  const session = getAuthSessionVersion();
  startGtcRuntime(owner);
  const pmA = checked.legA.type === "Polymarket";
  const pm = pmA ? checked.legA : checked.legB;
  const other = pmA ? checked.legB : checked.legA;
  const account = (pmA ? checked.accountA : checked.accountB)!;
  const otherAccount = (pmA ? checked.accountB : checked.accountA)!;
  const submitOther = prepareOtherLeg(otherAccount, other, checked.linkId);
  const otherBinding = () => JSON.stringify([otherAccount.accountId, otherAccount.provider, otherAccount.token, otherAccount.gateway, otherAccount.currency, other.betMoney, other.odds, other.matchId, other.betId, other.itemId, other.target, other.data]);
  const frozenOther = otherBinding();
  const checkSession = () => {
    if (!isAuthSessionCurrent(session) || !user.config.betting)
      throw new Error("自动下注或用户会话已停止");
  };
  const validateOther = () => {
    checkSession();
    if (otherBinding() !== frozenOther || !other.data || other.checkError)
      throw new Error("GTC 对侧冻结预检或账号已改变");
  };
  const historyAccounts = [account, otherAccount].filter(row => params.config.noSameBet || row.maxBetCount || row.lastOdds);
  if (historyAccounts.length)
    await refreshGtcRecords(params.bet.id, historyAccounts.map(row => row.accountId));
  assertGtcHistoryAllowsLeg(owner, account, params.bet.id, pm.target, pm.odds, params.config.noSameBet);
  assertGtcHistoryAllowsLeg(owner, otherAccount, params.bet.id, other.target, other.odds, params.config.noSameBet);
  const { prepareGtcBuy, pmSubmitMaker } = await import("@changmen/venue-adapter/polymarket/gtc");
  const prepared = await prepareGtcBuy(account, pm);

  const fx = getExchange(resolveAccountCurrency(account.provider, account.currency));
  const otherFx = getExchange(resolveAccountCurrency(otherAccount.provider, otherAccount.currency));
  if ((pm.stakeExchange != null && pm.stakeExchange !== fx)
    || (other.stakeExchange != null && other.stakeExchange !== otherFx))
    throw new Error("GTC 预检金额单位与场馆原币不一致，禁止发送双腿");
  const costs = Number(prepared.maxPrincipal) * fx + other.betMoney * otherFx;
  const ratio = Math.min(Number(prepared.shares) * fx, other.betMoney * otherFx * other.odds) / costs;
  if (!Number.isFinite(ratio) || ratio < params.config.profit)
    throw new Error(`GTC 签单本金与份数舍入后利润不足：${ratio.toFixed(6)}`);
  // [changmen 扩展] 签单、时钟和冻结输入全部就绪后才创建执行；提交时只复核失效或已消费。
  await prepared.prepareSubmit();
  validateOther(); prepared.validate();
  const { submit: _submit, validate: _validate, prepareSubmit: _prepareSubmit, ...frozenPm } = prepared;
  void _submit; void _validate; void _prepareSubmit;
  const plan: GtcPlan = { ...frozenPm, playerId: Number(account.accountId), otherPlayerId: Number(otherAccount.accountId), originalPmLeg: pmA ? "A" : "B", otherProvider: otherAccount.provider, otherTarget: other.target, otherOdds: other.odds, otherStake: other.betMoney, matchId: params.match.id, betRowId: params.bet.id, otherVenueMatchId: other.matchId, otherVenueItemId: other.itemId, linkId: checked.linkId, tokenId: pm.itemId, conditionId: pm.betId, target: pm.target, match: params.match.title, bet: params.bet.getBetName(), item: pm.target, fx, parallel: params.config.betSorting === "Parallel" };
  const id = crypto.randomUUID();
  acceptGtc(await createGtc(id, pmSubmitMaker(account), plan));
  const finishSubmission = beginGtcInitialDispatch(id);
  const current = () => currentGtc(id);
  let closeTask: Promise<void> | undefined;
  const close = () => {
    finishSubmission();
    return closeTask ??= mutateGtc(id, { kind: "close" }).then(() => {}).catch((error) => { closeTask = undefined; throw error; });
  };
  const summary = () => gtcExecutionResult(current());

  async function submissionFailure(leg: "PM" | "OTHER", error: unknown, sent: boolean): Promise<BetResult> {
    const message = error instanceof Error ? error.message : String(error);
    const result = new BetResult(leg === "PM" ? "Polymarket" : otherAccount.provider, false, message,
      undefined, sent ? undefined : { pmSubmitNotSent: true });
    result.pmSubmitUnknown = sent; result.link = checked.linkId;
    result.orderId = sent && leg === "PM" ? current().orderId || plan.orderHash : null;
    result.observation = leg === "PM" ? pm.observation : other.observation;
    // [changmen 扩展] 尚未调用场馆发送不等于超时未知；授权仍不可重用，首腿回执不受影响。
    await mutateGtc(id, !sent ? { kind: "not_sent", leg, message }
      : leg === "PM" ? { kind: "ack", state: "unknown", message }
        : { kind: "other", state: "unknown", message }).catch((failure) => {
      result.message += `；执行状态记录失败：${failure instanceof Error ? failure.message : String(failure)}`;
    });
    try { result.saveLog(leg === "PM" ? account : otherAccount); }
    catch { /* 记录异常不改变发送事实或中断另一腿收尾。 */ }
    return result;
  }

  async function submitPmCore(): Promise<BetResult> {
    let sent = false;
    let received: BetResult | undefined;
    try {
      checkSession(); await prepared.prepareSubmit(); checkSession();
      await mutateGtc(id, { kind: "authorize_pm" });
      checkSession();
      sent = true;
      const ack = await prepared.submit();
      if (ack.pmSubmitNotSent && ack.success === false && !ack.orderID)
        return submissionFailure("PM", new Error(ack.errorMsg || "PM 发送前检查失败"), false);
      const accepted = ack.success === true && Boolean(ack.orderID);
      const result = new BetResult("Polymarket", accepted, accepted ? "GTC 已受理，成交继续核对" : "GTC 结果待核实", undefined, ack);
      result.orderId = ack.orderID ?? null; result.link = checked.linkId; result.pending = accepted;
      result.pmSubmitUnknown = !accepted && ack.success !== false;
      received = result;
      await mutateGtc(id, { kind: "ack", state: accepted ? "accepted" : ack.success === false ? "rejected" : "unknown", orderId: ack.orderID, message: accepted ? "" : ack.errorMsg || "官方未确认受理" });
      result.observation = pm.observation; result.saveLog(account);
      result.message = gtcStateLabel(current());
      return result;
    }
    catch (error) {
      // [changmen 扩展] 已取得回执后，记录或展示异常不能把首腿成功改为未知或跳过第二腿。
      if (received) return received;
      return submissionFailure("PM", error, sent);
    }
  }

  return {
    // [changmen 扩展] 原 GTC V1 许可范围保持：首次原腿一次发送，未完结由人工处理。
    actions: { retry: false, makeup: false, autoSell: false, registerRejectMonitor: false, broadcast: false },
    finishSubmission,
    close,
    summary,
    legs: new Map([
      [pm, {
        validate: () => { checkSession(); prepared.validate(); },
        async submit() {
          let placed!: BetResult;
          await notifyBet(account, pm, async () => { placed = await submitPmCore(); return summary(); }, gtcPmNotice, checked.waitSec, { matchTitle: params.match.title, betName: params.bet.getBetName() });
          return placed;
        },
        async confirm() {
          // [A8 可证实] 双腿发送后再核对；[changmen 扩展] GTC 挂单继续后台监控。
          if (current().submit === "accepted") await pollGtc(id).catch(() => {});
          const fact = summary().pm;
          return { orders: [], rejected: fact.submission === "rejected", pendingConfirm: fact.fill !== "full" || Boolean(current().error) || Boolean(gtcProgress.queryIssues[id]) };
        },
        facts: () => summary().pm,
        markConfirmed: () => markGtcLegOnce(current(), "PM"),
        rejectWaitSec: 0,
      }],
      [other, {
        validate: validateOther,
        async submit() {
          let sent = false;
          let received: BetResult | undefined;
          try {
            validateOther(); await mutateGtc(id, { kind: "authorize_other" }); checkSession();
            other.deferPostAcceptSettlement = true;
            sent = true;
            const result = await submitOther();
            received = result;
            const unknown = result.pmSubmitUnknown || (!result.success && !result.response);
            await mutateGtc(id, { kind: "other", state: unknown ? "unknown" : result.success ? "accepted" : "rejected", orderId: result.orderId ?? undefined, message: result.message ?? "" });
            if (unknown) result.pmSubmitUnknown = true;
            return result;
          }
          catch (error) {
            if (received) return received;
            return submissionFailure("OTHER", error, sent);
          }
        },
        async confirm(result: BetResult) {
          // [changmen 扩展] 原提交未知仍交给既有后台原单监控，不在首次收尾伪造受理事实。
          if (!result.success)
            return { orders: [], rejected: false, pendingConfirm: true };
          const outcome = await settleGtcOtherLeg(otherAccount, result, current, 0);
          const original = findGtcOtherOrder(current(), outcome.orders);
          const rejected = outcome.rejected || original?.status === "reject" || original?.status === "return";
          const pendingConfirm = outcome.pendingConfirm || !original || original.status === "pending";
          await mutateGtc(id, { kind: "other", state: rejected ? "rejected" : pendingConfirm ? "pending" : "filled", orderId: original?.orderId || result.orderId || undefined, message: pendingConfirm ? "对侧原单成交待确认，禁止补单" : "" });
          return { orders: outcome.orders, rejected, pendingConfirm };
        },
        facts: () => summary().other!,
        markConfirmed: () => markGtcLegOnce(current(), "OTHER"),
        rejectWaitSec: checked.waitSec,
      }],
    ]),
  };
}
