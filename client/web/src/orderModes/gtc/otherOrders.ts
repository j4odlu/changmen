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
import { getProvider } from "@/runtime/providers";
import { refreshGtcOrders, saveOrders } from "./ordersApi";
import { findGtcOtherOrder } from "./otherFacts";

export async function readGtcOtherOrders(account: PlatformAccount, row: GtcExecution): Promise<VenueOrder[]> {
  if (Number(account.accountId) !== row.plan.otherPlayerId || account.provider !== row.plan.otherProvider)
    throw new Error("GTC 原对侧账号身份不一致");
  const session = getAuthSessionVersion();
  const orders = await getProvider(account)?.getOrders?.(account);
  if (!isAuthSessionCurrent(session))
    throw new Error("GTC 会话已变更");
  const original = findGtcOtherOrder(row, orders ?? []);
  if (!original || !String(original.orderId ?? "").trim())
    return [];
  // 不修改场馆返回对象，不更新账号全局统计，不保存无关订单。
  const matched = { ...original, link: row.plan.linkId, pmGtcExecutionId: row.id };
  await saveOrders(account, [matched]);
  if (!isAuthSessionCurrent(session))
    throw new Error("GTC 会话已变更");
  void refreshGtcOrders();
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
    const outcome = await resolveVenueLegOutcome(account, result, () => readGtcOtherOrders(account, current()), {
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
