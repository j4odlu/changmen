import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import { pmSubmissionFromResult } from "@changmen/shared/pm_submission";
import { scaleUsdtToCnyDisplay } from "@changmen/shared/currency";
import { wait } from "@changmen/client-core/shared/wait";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { saveOrders } from "@/api/order";
import { resolveOrderItemLabel } from "@/shared/orderItemDisplay";
import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";

/** [changmen 扩展] delayed/提交未知仍是同一笔订单；Pending 不代表已成交持仓。 */
export async function persistPendingPmOrder(
  account: PlatformAccount, option: BetOption, result: BetResult,
): Promise<void> {
  if (account.provider !== "Polymarket" || !result.pending) return;
  const submission = pmSubmissionFromResult(result, account.accountId);
  if (!submission) throw new Error("PM 提交记录缺失，无法保存待确认订单");
  const match = String(option.match?.title ?? "");
  const target = String(option.target ?? "");
  const named = option.target === "Away" ? option.bet?.awayName : option.bet?.homeName;
  const order: VenueOrder = {
    provider: "Polymarket", orderId: submission.orderId, status: "pending",
    createAt: submission.submittedAt, odds: Number(option.odds) || 0,
    betMoney: scaleUsdtToCnyDisplay(submission.stakeUsdc), money: 0, reward: 0,
    game: String(option.match?.game ?? ""), match,
    bet: String(option.bet?.getBetName?.() ?? ""),
    item: String(named ?? "").trim() || resolveOrderItemLabel(target, match) || target,
    pmSubmission: submission, pmSide: "buy", pmOrigin: "changmen",
    pmConditionId: option.betId, pmTokenId: option.itemId,
    venueMatchId: String(option.matchId), venueItemId: target,
    ...(Number(option.diagnosticLinkId) ? { link: Number(option.diagnosticLinkId) } : {}),
  };
  const version = getAuthSessionVersion();
  for (let attempt = 0; ; attempt++) {
    if (!isAuthSessionCurrent(version)) throw new Error("会话已切换，停止保存待确认订单");
    try { await saveOrders(account, [order]); break; }
    catch {
      // 只重试同一份订单写入；不能在缺少完整订单时另建一条无名称的拒单。
      await wait(Math.min(30_000, 500 * 2 ** Math.min(attempt, 6)));
    }
  }
  if (isAuthSessionCurrent(version)) refreshOrderListAfterBind();
}
