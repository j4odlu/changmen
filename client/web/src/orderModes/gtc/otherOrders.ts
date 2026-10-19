/** [changmen 扩展] PM 配对状态消费场馆订单事实；RAY 沿用公共拉单、保存和绑定流程。 */
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { wait } from "@changmen/client-core/shared/wait";
import { isPendingConfirmVenueProvider, isPredictFunProvider } from "@changmen/shared/account_multiply";
import { isVenueLegConfirmedUnfilled, isVenueLegPendingConfirm } from "@changmen/venue-browser/adapter/contract";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { resolveVenueLegOutcome } from "@/domain/betting/resolveVenueLegOutcome";
import { observedRayOrders } from "@/runtime/orderMonitoring/rayOrders";
import { getProvider } from "@/runtime/providers";
import { refreshGtcOrders, saveOrders } from "./ordersApi";
import { findGtcOtherOrder } from "./otherFacts";
import { settleArbLegUntilTerminal } from "@/stores/betting/autoBet/arbLegSettle";
import { getActivePinia } from "pinia";
import { useRayOrderContextStore } from "@/runtime/rayOrderMonitor/contextStore";

/** [changmen 扩展] 延迟原单身份由公共 RAY 监控确认，PM 模式只消费该结果。 */
function commonRayOrderId(row: GtcExecution): string | undefined {
  if (!getActivePinia()) return undefined;
  const contexts = useRayOrderContextStore();
  if (contexts.ownerUserId !== row.owner) return undefined;
  const ids = new Set([...contexts.tasks.values()]
    .filter(task => task.userId === row.owner && task.linkId === row.plan.linkId
      && task.accountId === row.plan.otherPlayerId && (task.monitorBound || task.bindingSaved))
    .map(task => task.boundOrderId).filter((id): id is string => Boolean(id)));
  return ids.size === 1 ? [...ids][0] : undefined;
}

export async function readGtcOtherOrders(account: PlatformAccount, row: GtcExecution, options: { fresh?: boolean } = {}): Promise<VenueOrder[]> {
  if (Number(account.accountId) !== row.plan.otherPlayerId || account.provider !== row.plan.otherProvider)
    throw new Error("GTC 原对侧账号身份不一致");
  const session = getAuthSessionVersion();
  // [changmen 扩展] RAY 只消费公共查单结果；首次主动确认也由公共流程负责。
  const snapshot = account.provider === "RAY" ? observedRayOrders(account) : undefined;
  const orders = account.provider === "RAY"
    ? snapshot && snapshot.startedAt >= row.other.submittedAt ? snapshot.orders : []
    : await getProvider(account)?.getOrders?.(account);
  if (!isAuthSessionCurrent(session))
    throw new Error("GTC 会话已变更");
  // [changmen 扩展] 被动结果可能早于普通订单绑 Link；无单号时不能抢认相似的新 FOK 单。
  const orderId = row.other.orderId || (account.provider === "RAY" ? commonRayOrderId(row) : undefined);
  const evidence = account.provider === "RAY" && !orderId
    ? (orders ?? []).filter(order => ("pmGtcExecutionId" in order && order.pmGtcExecutionId === row.id) || Number(order.link) === row.plan.linkId)
    : orders;
  const original = findGtcOtherOrder(orderId ? { ...row, other: { ...row.other, orderId } } : row, evidence ?? []);
  if (!original || !String(original.orderId ?? "").trim())
    return [];
  // 不修改场馆返回对象，不更新账号全局统计，不保存无关订单。
  const matched = { ...original, link: row.plan.linkId, pmGtcExecutionId: row.id };
  // [changmen 扩展] 后台监控只供客户端事实判断；保存仍由正常同步或首次确认负责。
  if (account.provider === "RAY" || !options.fresh) {
    // 保留异步消费前的会话及快照复核，不再通过等待订单保存来完成这道检查。
    await Promise.resolve();
    if (!isAuthSessionCurrent(session))
      throw new Error("GTC 会话已变更");
    if (account.provider === "RAY" && observedRayOrders(account) !== snapshot)
      throw new Error("RAY 旧订单结果已被新查询替代");
    return [matched];
  }
  await saveOrders(account, [matched]);
  if (!isAuthSessionCurrent(session))
    throw new Error("GTC 会话已变更");
  void refreshGtcOrders().catch(() => {});
  return [matched];
}

/** 保留场馆原确认/拒单等待；回调只提供已匹配的原单，不进入 FOK 的拉单保存编排。 */
export async function settleGtcOtherLeg(
  account: PlatformAccount,
  result: BetResult,
  current: () => GtcExecution,
  rejectWaitSec: number,
): Promise<{ orders: VenueOrder[]; rejected: boolean; pendingConfirm: boolean }> {
  if (account.provider === "RAY") {
    return settleArbLegUntilTerminal(account, result, {
      rejectWaitSec,
      pendingBindLinkId: current().plan.linkId,
    });
  }
  const rounds = isPredictFunProvider(account.provider) ? 6 : 1;
  for (let round = 0; ; round++) {
    // [changmen 扩展] 保持原等待后再查回执，不复用等待前开始的后台查询。
    const outcome = await resolveVenueLegOutcome(account, result, () => readGtcOtherOrders(account, current(), { fresh: true }), {
      confirmPostAccepted: isPendingConfirmVenueProvider(account.provider),
      rejectWaitSec,
    });
    const original = findGtcOtherOrder(current(), outcome.orders);
    const pendingConfirm = !original || isVenueLegPendingConfirm(outcome);
    if (!pendingConfirm || round + 1 === rounds)
      return { orders: outcome.orders, rejected: Boolean(original) && isVenueLegConfirmedUnfilled(outcome), pendingConfirm };
    await wait(2000 * (round + 1));
  }
}
