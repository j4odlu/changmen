import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type {
  PlatformProvider,
  ResolveLegOutcomeOpts,
  VenueLegOutcome,
  VenueOrder,
} from "../contract";
import { sortVenueOrdersNewestFirst } from "../contract";
import { venueRejectWaitBeforePoll } from "../shared/rejectWait";

/** [A8 可证实] 场馆订单列表首条 status 为 reject 视为拒单 */
export function isA8VenueReject(orders: VenueOrder[]): boolean {
  return orders.length > 0 && orders[0].status === "reject";
}

async function pullVenueOrders(
  provider: PlatformProvider,
  account: PlatformAccount,
  opts?: ResolveLegOutcomeOpts,
) {
  // 编排层回调（含 saveOrders）；须在 wait 之后调用，避免预拉快照锁死拒单检测
  if (opts?.fetchVenueOrders)
    return sortVenueOrdersNewestFirst(await opts.fetchVenueOrders());
  if (opts?.orders)
    return sortVenueOrdersNewestFirst(opts.orders);
  if (!provider.getOrders)
    return [];
  return sortVenueOrdersNewestFirst(await provider.getOrders(account));
}

/**
 * A8 场馆订单状态层：wait → 一次拉单 → 仅 `orders[0].status`。
 */
export async function resolveA8VenueLegOutcome(
  provider: PlatformProvider,
  account: PlatformAccount,
  _result?: BetResult,
  opts?: ResolveLegOutcomeOpts,
): Promise<VenueLegOutcome> {
  await venueRejectWaitBeforePoll(opts?.rejectWaitSec);
  const orders = await pullVenueOrders(provider, account, opts);
  return {
    orders,
    settlement: isA8VenueReject(orders) ? "unfilled" : "filled",
  };
}

/** 为未实现 resolveLegOutcome 的 A8 provider 注入默认拒单检测 */
export function withA8ResolveLegOutcome(provider: PlatformProvider): PlatformProvider {
  if (provider.resolveLegOutcome || !provider.getOrders)
    return provider;
  return {
    ...provider,
    resolveLegOutcome(account, result, opts) {
      return resolveA8VenueLegOutcome(provider, account, result, opts);
    },
  };
}
