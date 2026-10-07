import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import type { ResolveLegOutcomeOpts, VenueLegOutcome, VenueOrder } from "@changmen/venue-adapter/contract";
import { isA8VenueReject } from "@changmen/venue-adapter/adaptation";
import { sortVenueOrdersNewestFirst } from "@changmen/venue-adapter/contract";
import { getProvider } from "@/runtime/providers";
import { observeOrder } from "@/services/orderObservation";
import { submissionVenueStatus } from "@/services/venueSettlementEvidence";

export type { ResolveLegOutcomeOpts };

/**
 * 编排层入口：委托场馆 provider.resolveLegOutcome。
 * fetchVenueOrders 通常为 accountStore.updateVenueOrders（含 saveOrders / 统计）。
 *
 * [A8 可证实] tip → wait(q) → updateOrders：有 resolveLegOutcome 时不预拉，
 * 只传 fetchVenueOrders，由场馆层 wait 后再拉（含 A8 / PM / PF / SX）。
 */
export async function resolveVenueLegOutcome(
  account: PlatformAccount,
  result: BetResult | undefined,
  fetchVenueOrders: () => Promise<VenueOrder[] | undefined>,
  opts: ResolveLegOutcomeOpts = {},
): Promise<VenueLegOutcome> {
  const pullSorted = async () => sortVenueOrdersNewestFirst((await fetchVenueOrders()) ?? []);
  const provider = getProvider(account);
  // [changmen 扩展] 只在实际进入订单检测时记录起点；跳过复检的补单不会调用本入口。
  try {
    if (result && (result.success || result.pmSubmitUnknown)
      && (account.provider !== "Polymarket" || submissionVenueStatus(result) === "delayed" || result.pmSubmitUnknown))
      observeOrder(result.observation, result.link, "decision", { provider: account.provider, accountId: account.accountId,
        orderId: result.orderId || undefined, phase: "reject_detection", reasonCode: "reject_detection_started", outcome: "pending", source: "orchestration" });
  }
  catch { /* 检测日志异常不能阻断场馆查询 */ }

  if (provider?.resolveLegOutcome) {
    return provider.resolveLegOutcome(account, result, {
      ...opts,
      fetchVenueOrders: pullSorted,
    });
  }

  const orders = await pullSorted();
  return {
    orders,
    settlement: isA8VenueReject(orders) ? "unfilled" : "filled",
  };
}
