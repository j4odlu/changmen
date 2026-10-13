/** [changmen 扩展] GTC 只核对和保存匹配的原单，禁止使用 FOK 的最新单绑定或整批保存。 */
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { wait } from "@changmen/client-core/shared/wait";
import { isPendingConfirmVenueProvider, isPredictFunProvider } from "@changmen/shared/account_multiply";
import { isVenueLegConfirmedUnfilled, isVenueLegPendingConfirm } from "@changmen/venue-adapter/contract";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { resolveVenueLegOutcome } from "@/domain/betting/resolveVenueLegOutcome";
import { observedRayOrders } from "@/runtime/orderMonitoring/rayOrders";
import { getProvider } from "@/runtime/providers";
import { refreshGtcOrders, saveOrders } from "./ordersApi";
import { findGtcOtherOrder } from "./otherFacts";

export async function readGtcOtherOrders(account: PlatformAccount, row: GtcExecution, options: { fresh?: boolean } = {}): Promise<VenueOrder[]> {
  if (Number(account.accountId) !== row.plan.otherPlayerId || account.provider !== row.plan.otherProvider)
    throw new Error("GTC 原对侧账号身份不一致");
  const session = getAuthSessionVersion();
  // [changmen 扩展] RAY 后台只读取原监控结果；首单拒单确认仍在原等待后独立查询。
  const snapshot = account.provider === "RAY" ? observedRayOrders(account) : undefined;
  const orders = account.provider === "RAY" && !options.fresh
    ? snapshot && snapshot.startedAt >= row.other.submittedAt ? snapshot.orders : []
    : await getProvider(account)?.getOrders?.(account);
  if (!isAuthSessionCurrent(session))
    throw new Error("GTC 会话已变更");
  // [changmen 扩展] 被动结果可能早于普通订单绑 Link；无单号时不能抢认相似的新 FOK 单。
  const evidence = account.provider === "RAY" && !options.fresh && !row.other.orderId
    ? (orders ?? []).filter(order => ("pmGtcExecutionId" in order && order.pmGtcExecutionId === row.id) || Number(order.link) === row.plan.linkId)
    : orders;
  const original = findGtcOtherOrder(row, evidence ?? []);
  if (!original || !String(original.orderId ?? "").trim())
    return [];
  // 不修改场馆返回对象，不更新账号全局统计，不保存无关订单。
  const matched = { ...original, link: row.plan.linkId, pmGtcExecutionId: row.id };
  await saveOrders(account, [matched]);
  if (!isAuthSessionCurrent(session))
    throw new Error("GTC 会话已变更");
  if (account.provider === "RAY" && !options.fresh && observedRayOrders(account) !== snapshot)
    throw new Error("RAY 旧订单结果已被新查询替代");
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
  const rounds = isPredictFunProvider(account.provider) ? 6 : 1;
  for (let round = 0; ; round++) {
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
