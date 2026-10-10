import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import type { GtcExecutionResult } from "@/orderModes/gtc/executionResult";
/** [changmen 扩展] GTC V1 编排：只提交原始双腿一次，不进入现有补单/自动卖出路径。 */
import type { ArbBetAttemptParams, ArbBetChecked } from "@/stores/betting/autoBet/phases/types";
import { BetResult } from "@changmen/client-core/models/betResult";
import { getExchange, resolveAccountCurrency } from "@changmen/shared/currency";
import { gtcStateLabel, gtcUnits } from "@changmen/shared/pm_gtc";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { ExecutionError } from "@/orderModes/gtc/executionResult";
import { syncActiveBetLeg, syncActiveBetPhase } from "@/stores/betting/activeBetRunSync";
import { useUserStore } from "@/stores/userStore";
import { createGtc } from "./api";
import { placeOtherLeg } from "./gateway";
import { findGtcOtherOrder } from "./otherFacts";
import { settleGtcOtherLeg } from "./otherOrders";
import { gtcExecutionResult } from "./result";
import { acceptGtc, currentGtc, markGtcLegOnce, mutateGtc, pollGtc, pollGtcOther, refreshGtcRecords, startGtcRuntime } from "./runtime";
import { assertGtcHistoryAllowsLeg } from "./successMarkers";
import { gtcProgress } from "./gtcProgressState";
import { notifyBet } from "@/shared/betNotification";
import { gtcPmNotice } from "./notifications";

export function isGtcPair(checked: ArbBetChecked): boolean {
  return checked.betBothLegs && !checked.singleLegByRate && Boolean(checked.accountA && checked.accountB)
    && [checked.legA.type, checked.legB.type].filter(type => type === "Polymarket").length === 1;
}
export async function executeGtc(params: ArbBetAttemptParams, checked: ArbBetChecked): Promise<GtcExecutionResult> {
  if (!isGtcPair(checked))
    throw new Error("GTC V1 仅支持一条 PM 腿的双边自动套利");
  const user = useUserStore(); const owner = String(user.userId);
  const session = getAuthSessionVersion();
  startGtcRuntime(owner);
  const pmA = checked.legA.type === "Polymarket";
  const pm = pmA ? checked.legA : checked.legB;
  const other = pmA ? checked.legB : checked.legA;
  const account = (pmA ? checked.accountA : checked.accountB)!;
  const otherAccount = (pmA ? checked.accountB : checked.accountA)!;
  // [changmen 扩展] 用户启用同盘口历史规则才读取该盘口；旧单全量恢复不决定新执行是否就绪。
  const historyAccounts = [account, otherAccount].filter(row => params.config.noSameBet || row.maxBetCount || row.lastOdds);
  if (historyAccounts.length)
    await refreshGtcRecords(params.bet.id, historyAccounts.map(row => row.accountId));
  assertGtcHistoryAllowsLeg(owner, account, params.bet.id, pm.target, pm.odds, params.config.noSameBet);
  assertGtcHistoryAllowsLeg(owner, otherAccount, params.bet.id, other.target, other.odds, params.config.noSameBet);
  const { prepareGtcBuy, pmSubmitMaker } = await import("@changmen/venue-adapter/polymarket/gtc");
  const maker = pmSubmitMaker(account);
  // [changmen 扩展] 原单状态仅约束自身；同钱包已有挂单不阻止新的独立套利。
  const prepared = await prepareGtcBuy(account, pm);
  const otherBinding = () => JSON.stringify([otherAccount.accountId, otherAccount.provider, otherAccount.token, otherAccount.gateway, otherAccount.currency, other.betMoney, other.odds, other.matchId, other.betId, other.itemId, other.target, other.data]);
  const frozenOther = otherBinding();
  const validateOther = () => {
    if (otherBinding() !== frozenOther || !other.data)
      throw new Error("GTC 对侧冻结预检或账号已改变");
  };
  const fx = getExchange(resolveAccountCurrency(account.provider, account.currency));
  const otherFx = getExchange(resolveAccountCurrency(otherAccount.provider, otherAccount.currency));
  if ((pm.stakeExchange != null && pm.stakeExchange !== fx)
    || (other.stakeExchange != null && other.stakeExchange !== otherFx)) {
    throw new Error("GTC 预检金额单位与场馆原币不一致，禁止发送双腿");
  }
  const costs = Number(prepared.maxPrincipal) * fx + other.betMoney * otherFx;
  const ratio = Math.min(Number(prepared.shares) * fx, other.betMoney * otherFx * other.odds) / costs;
  if (!Number.isFinite(ratio) || ratio < params.config.profit)
    throw new Error(`GTC 签单本金与份数舍入后利润不足：${ratio.toFixed(6)}`);
  const plan: GtcPlan = { ...prepared, playerId: Number(account.accountId), otherPlayerId: Number(otherAccount.accountId), originalPmLeg: pmA ? "A" : "B", otherProvider: otherAccount.provider, otherTarget: other.target, otherOdds: other.odds, otherStake: other.betMoney, matchId: params.match.id, betRowId: params.bet.id, otherVenueMatchId: other.matchId, otherVenueItemId: other.itemId, linkId: checked.linkId, tokenId: pm.itemId, conditionId: pm.betId, target: pm.target, match: params.match.title, bet: params.bet.getBetName(), item: pm.target, fx, parallel: params.config.betSorting === "Parallel" };
  // 持久化计划不含签名/凭证/函数。
  const { submit: _submit, validate: _validate, ...persistedPlan } = plan as GtcPlan & { submit?: unknown; validate?: unknown };
  void _submit; void _validate;
  const id = crypto.randomUUID();
  acceptGtc(await createGtc(id, maker, persistedPlan));
  syncActiveBetPhase(params.bet.id, "placing", "GTC V1：提交原始订单一次");
  const checkSession = () => {
    if (!isAuthSessionCurrent(session) || !user.config.betting)
      throw new Error("自动下注或用户会话已停止");
  };
  let otherResult: BetResult | undefined;
  async function submitOther() {
    checkSession();
    validateOther();
    await mutateGtc(id, { kind: "authorize_other" });
    checkSession(); other.deferPostAcceptSettlement = true;
    try {
      otherResult = await placeOtherLeg(otherAccount, other, checked.linkId);
      // 网关会把 POST 异常转换成 success=false；没有场馆响应不能证明未受理。
      const unknown = otherResult.pmSubmitUnknown || (!otherResult.success && !otherResult.response);
      await mutateGtc(id, { kind: "other", state: unknown ? "unknown" : otherResult.success ? "accepted" : "rejected", orderId: otherResult.orderId ?? undefined, message: otherResult.message ?? "" });
      syncActiveBetLeg(params.bet.id, pmA ? "B" : "A", unknown ? "pending_confirm" : otherResult.success ? "submitted" : "rejected", otherResult.message ?? "");
      // [changmen 扩展] 受理即拉原单展示，不等 PM 查询或拒单等待；终态仍由 settle 核对。
      if (otherResult.success)
        void pollGtcOther(id, false).catch(() => {});
    }
    catch (error) {
      await mutateGtc(id, { kind: "other", state: "unknown", message: error instanceof Error ? error.message : "对侧提交结果未知" });
    }
  }
  async function submitPm() {
    await notifyBet(account, pm, async () => {
      await submitPmCore();
      return gtcExecutionResult(currentGtc(id));
    }, gtcPmNotice, checked.waitSec, { matchTitle: params.match.title, betName: params.bet.getBetName() });
  }
  async function submitPmCore() {
    checkSession();
    await mutateGtc(id, { kind: "authorize_pm" });
    checkSession();
    try {
      const ack = await prepared.submit();
      const accepted = ack.success === true && Boolean(ack.orderID);
      await mutateGtc(id, { kind: "ack", state: accepted ? "accepted" : ack.success === false ? "rejected" : "unknown", orderId: ack.orderID, message: accepted ? "" : ack.errorMsg || "官方未确认受理" });
      const result = new BetResult("Polymarket", accepted, accepted ? "GTC 已受理，成交继续核对" : "GTC 结果待核实", undefined, ack);
      result.orderId = ack.orderID ?? null; result.link = checked.linkId; result.pending = accepted;
      result.observation = pm.observation; result.saveLog(account);
      if (accepted)
        await pollGtc(id).catch(() => {}); // 查询失败不改写已收到的 accepted 回执。
      const row = currentGtc(id);
      syncActiveBetLeg(params.bet.id, pmA ? "A" : "B", accepted ? gtcUnits(row.matched) > 0n ? "confirmed" : "submitted" : row.submit === "rejected" ? "rejected" : "pending_confirm", gtcStateLabel(row));
    }
    catch (error) {
      await mutateGtc(id, { kind: "ack", state: "unknown", message: error instanceof Error ? error.message : "GTC 提交结果待核实" });
    }
  }
  let closed: GtcExecution;
  let failed = false;
  let failure: unknown;
  try {
    prepared.validate(); validateOther();
    if (plan.parallel) {
      await Promise.allSettled([submitPm(), submitOther()]);
    }
    else if (pmA) {
      await submitPm();
      const row = currentGtc(id);
      // 首轮可靠正成交才允许原始第二腿；零成交/未知不等待未来 maker 成交再补。
      if (row.submit === "accepted" && row.complete && !row.error && !gtcProgress.queryIssues[id] && gtcUnits(row.matched) > 0n && row.deadlineAt > Date.now())
        await submitOther();
    }
    else {
      await submitOther();
      if (otherResult?.success && !currentGtc(id).manual)
        await submitPm();
    }
    if (otherResult?.success) {
      const outcome = await settleGtcOtherLeg(otherAccount, otherResult, () => currentGtc(id), checked.waitSec);
      const original = findGtcOtherOrder(currentGtc(id), outcome.orders);
      const rejected = outcome.rejected || original?.status === "reject" || original?.status === "return";
      const pending = outcome.pendingConfirm || !original || original.status === "pending";
      await mutateGtc(id, { kind: "other", state: rejected ? "rejected" : pending ? "pending" : "filled", orderId: original?.orderId || otherResult.orderId || undefined, message: pending ? "对侧原单成交待确认，禁止补单" : "" });
      syncActiveBetLeg(params.bet.id, pmA ? "B" : "A", rejected ? "rejected" : pending ? "pending_confirm" : "confirmed");
      if (!rejected && !pending)
        markGtcLegOnce(currentGtc(id), "OTHER");
    }
  }
  catch (error) {
    failed = true;
    failure = error;
  }
  finally {
    closed = await mutateGtc(id, { kind: "close" });
  }
  const result = gtcExecutionResult(closed);
  if (failed)
    throw new ExecutionError(result, failure);
  return result;
}
