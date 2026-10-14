import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { OriginalExecutionLifecycle } from "@/domain/betting/originalLegExecution";
import type { ArbBetAttemptParams, ArbBetChecked } from "@/stores/betting/autoBet/phases/types";
import { BetResult } from "@changmen/client-core/models/betResult";
import { getExchange, resolveAccountCurrency } from "@changmen/shared/currency";
import { gtcStateLabel, gtcUnits } from "@changmen/shared/pm_gtc";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { notifyBet } from "@/shared/betNotification";
import { createGtc } from "./api";
import { placeOtherLeg } from "./gateway";
import { findGtcOtherOrder } from "./otherFacts";
import { settleGtcOtherLeg } from "./otherOrders";
import { gtcExecutionResult } from "./result";
import { gtcPmNotice } from "./notifications";
import { acceptGtc, currentGtc, markGtcLegOnce, mutateGtc, pollGtc, pollGtcOther, refreshGtcRecords, startGtcRuntime } from "./runtime";
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
  const historyAccounts = [account, otherAccount].filter(row => params.config.noSameBet || row.maxBetCount || row.lastOdds);
  if (historyAccounts.length)
    await refreshGtcRecords(params.bet.id, historyAccounts.map(row => row.accountId));
  assertGtcHistoryAllowsLeg(owner, account, params.bet.id, pm.target, pm.odds, params.config.noSameBet);
  assertGtcHistoryAllowsLeg(owner, otherAccount, params.bet.id, other.target, other.odds, params.config.noSameBet);
  const { prepareGtcBuy, pmSubmitMaker } = await import("@changmen/venue-adapter/polymarket/gtc");
  const prepared = await prepareGtcBuy(account, pm);
  const otherBinding = () => JSON.stringify([otherAccount.accountId, otherAccount.provider, otherAccount.token, otherAccount.gateway, otherAccount.currency, other.betMoney, other.odds, other.matchId, other.betId, other.itemId, other.target, other.data]);
  const frozenOther = otherBinding();
  const checkSession = () => {
    if (!isAuthSessionCurrent(session) || !user.config.betting)
      throw new Error("自动下注或用户会话已停止");
  };
  const validateOther = () => {
    checkSession();
    if (otherBinding() !== frozenOther || !other.data)
      throw new Error("GTC 对侧冻结预检或账号已改变");
  };
  const fx = getExchange(resolveAccountCurrency(account.provider, account.currency));
  const otherFx = getExchange(resolveAccountCurrency(otherAccount.provider, otherAccount.currency));
  if ((pm.stakeExchange != null && pm.stakeExchange !== fx)
    || (other.stakeExchange != null && other.stakeExchange !== otherFx))
    throw new Error("GTC 预检金额单位与场馆原币不一致，禁止发送双腿");
  const costs = Number(prepared.maxPrincipal) * fx + other.betMoney * otherFx;
  const ratio = Math.min(Number(prepared.shares) * fx, other.betMoney * otherFx * other.odds) / costs;
  if (!Number.isFinite(ratio) || ratio < params.config.profit)
    throw new Error(`GTC 签单本金与份数舍入后利润不足：${ratio.toFixed(6)}`);
  const { submit: _submit, validate: _validate, prepareSubmit: _prepareSubmit, ...frozenPm } = prepared;
  void _submit; void _validate; void _prepareSubmit;
  const plan: GtcPlan = { ...frozenPm, playerId: Number(account.accountId), otherPlayerId: Number(otherAccount.accountId), originalPmLeg: pmA ? "A" : "B", otherProvider: otherAccount.provider, otherTarget: other.target, otherOdds: other.odds, otherStake: other.betMoney, matchId: params.match.id, betRowId: params.bet.id, otherVenueMatchId: other.matchId, otherVenueItemId: other.itemId, linkId: checked.linkId, tokenId: pm.itemId, conditionId: pm.betId, target: pm.target, match: params.match.title, bet: params.bet.getBetName(), item: pm.target, fx, parallel: params.config.betSorting === "Parallel" };
  const id = crypto.randomUUID();
  acceptGtc(await createGtc(id, pmSubmitMaker(account), plan));
  const current = () => currentGtc(id);
  let closeTask: Promise<void> | undefined;
  const close = () => closeTask ??= mutateGtc(id, { kind: "close" }).then(() => {}).catch((error) => { closeTask = undefined; throw error; });
  const summary = () => gtcExecutionResult(current());

  async function submitPmCore(): Promise<BetResult> {
    checkSession(); await prepared.prepareSubmit(); checkSession();
    await mutateGtc(id, { kind: "authorize_pm" });
    checkSession();
    try {
      const ack = await prepared.submit();
      const accepted = ack.success === true && Boolean(ack.orderID);
      await mutateGtc(id, { kind: "ack", state: accepted ? "accepted" : ack.success === false ? "rejected" : "unknown", orderId: ack.orderID, message: accepted ? "" : ack.errorMsg || "官方未确认受理" });
      const result = new BetResult("Polymarket", accepted, accepted ? "GTC 已受理，成交继续核对" : "GTC 结果待核实", undefined, ack);
      result.orderId = ack.orderID ?? null; result.link = checked.linkId; result.pending = accepted;
      result.pmSubmitUnknown = !accepted && ack.success !== false;
      result.observation = pm.observation; result.saveLog(account);
      if (accepted)
        await pollGtc(id).catch(() => {});
      result.message = gtcStateLabel(current());
      return result;
    }
    catch (error) {
      const message = error instanceof Error ? error.message : "GTC 提交结果待核实";
      await mutateGtc(id, { kind: "ack", state: "unknown", message });
      const result = new BetResult("Polymarket", false, message);
      result.pmSubmitUnknown = true; result.orderId = current().orderId || plan.orderHash; result.link = checked.linkId;
      result.observation = pm.observation; result.saveLog(account);
      return result;
    }
  }

  return {
    // [changmen 扩展] 原 GTC V1 许可范围保持：首次原腿一次发送，未完结由人工处理。
    actions: { retry: false, makeup: false, autoSell: false, registerRejectMonitor: false, broadcast: false },
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
        canContinueOriginalPair: () => {
          const row = current();
          return row.submit === "accepted" && row.complete && !row.error && !gtcProgress.queryIssues[id]
            && gtcUnits(row.matched) > 0n && row.deadlineAt > Date.now();
        },
        async confirm() {
          // 首轮已在提交回执后核对；挂单无需等到终态，本轮收尾不停止后台监控。
          const row = current(); const fact = summary().pm;
          return { orders: [], rejected: fact.submission === "rejected", pendingConfirm: fact.fill !== "full" || Boolean(row.error) || Boolean(gtcProgress.queryIssues[id]) };
        },
        facts: () => summary().pm,
        markConfirmed: () => markGtcLegOnce(current(), "PM"),
        rejectWaitSec: 0,
      }],
      [other, {
        validate: validateOther,
        async submit() {
          validateOther(); await mutateGtc(id, { kind: "authorize_other" }); checkSession();
          other.deferPostAcceptSettlement = true;
          try {
            const result = await placeOtherLeg(otherAccount, other, checked.linkId);
            const unknown = result.pmSubmitUnknown || (!result.success && !result.response);
            await mutateGtc(id, { kind: "other", state: unknown ? "unknown" : result.success ? "accepted" : "rejected", orderId: result.orderId ?? undefined, message: result.message ?? "" });
            if (unknown) result.pmSubmitUnknown = true;
            if (result.success) void pollGtcOther(id, false).catch(() => {});
            return result;
          }
          catch (error) {
            const message = error instanceof Error ? error.message : "对侧提交结果未知";
            await mutateGtc(id, { kind: "other", state: "unknown", message });
            const result = new BetResult(otherAccount.provider, false, message);
            result.pmSubmitUnknown = true; result.link = checked.linkId; result.observation = other.observation;
            return result;
          }
        },
        // [changmen 扩展] 公共 place 已要求提交结果 success；监控提前推进 pending/filled 不撤销第二腿资格。
        canContinueOriginalPair: () => !current().manual,
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
