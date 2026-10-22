import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ArbLegSettleResult } from "./arbLegSettle";
import { isVenueLegConfirmedUnfilled, isVenueLegPendingConfirm } from "@changmen/venue-browser/adapter/contract";
import { isPendingConfirmVenueProvider, isPredictFunProvider } from "@changmen/shared/account_multiply";
import { resolveVenueLegOutcome } from "@/domain/betting/resolveVenueLegOutcome";
import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";
import { useAccountStore } from "@/stores/accountStore";

/** [changmen 扩展] 确认只接收查询身份与等待策略；不读取名称、不创建拒单。 */
export interface ConfirmVenueBetOpts {
  rejectWaitSec?: number;
  pendingBindLinkId?: number;
  pmConditionId?: string;
}

export async function confirmVenueBet(
  account: PlatformAccount,
  result?: BetResult,
  opts: ConfirmVenueBetOpts = {},
): Promise<ArbLegSettleResult> {
  const pendingBindOrderId = String(result?.orderId ?? "").trim() || undefined;
  // [changmen 扩展] 首轮拉单已带最终 Link 落库（venueOrders.stampPendingBindLink），
  // 侧栏无需等不确定重拉 / 另一腿 settle。PF 不经 Client_SaveOrder，跳过。
  const canRefreshEarly = Boolean(opts.pendingBindLinkId)
    && !isPredictFunProvider(account.provider);
  let refreshedSidebar = false;
  const outcome = await resolveVenueLegOutcome(
    account,
    result,
    async () => {
      const orders = await useAccountStore().updateVenueOrders(account, {
        pendingBindLinkId: opts.pendingBindLinkId,
        pendingBindOrderId,
        // 官方 delayed：matched 后 trades 可能滞后；等 orderId 出现再 save
        waitForOrderId: pendingBindOrderId,
        // RAY 成功响应不返回 orderId；首轮列表尚未索引时短重试，避免漏单后等全局轮询。
        waitForRecentOrderAfterMs: String(account.provider).toUpperCase() === "RAY"
          ? Number(result?.beginTime) || undefined
          : undefined,
      });
      if (canRefreshEarly && !refreshedSidebar && orders?.length) {
        refreshedSidebar = true;
        refreshOrderListAfterBind();
      }
      return orders;
    },
    {
      confirmPostAccepted: isPendingConfirmVenueProvider(account.provider) && Boolean(result),
      rejectWaitSec: opts.rejectWaitSec,
      pmConditionId: opts.pmConditionId,
    },
  );
  const rejected = isVenueLegConfirmedUnfilled(outcome);
  const pendingConfirm = isVenueLegPendingConfirm(outcome);
  return { orders: outcome.orders, rejected, pendingConfirm };
}
