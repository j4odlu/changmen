/**
 * Predict.fun 订单状态层：POST 受理后轮询官方 GetOrder → filled / unfilled / timeout
 * @see https://dev.predict.fun/get-order-by-hash-25326901e0
 */

import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type {
  ResolveLegOutcomeOpts,
  VenueLegOutcome,
  VenueLegSettlement,
  VenueOrder,
} from "../contract";
import { sortVenueOrdersNewestFirst } from "../contract";
import { venueRejectWaitBeforePoll } from "../shared/rejectWait";
import { pfGetOrder } from "./pfClientApi";

/**
 * 前密后疏：wallet-first 快收；总间隔对齐服务端 waitForHouseOrderTerminal（约 25×300ms）。
 * 4×200 + 4×400 + 10×500 ≈ 7.4s，减少「已 CANCELLED 却先 timeout」。
 */
const DEFAULT_POLL_ATTEMPTS = 18;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/** @param attemptIndex 0-based，刚完成的轮次下标 */
function pollIntervalMs(attemptIndex: number): number {
  if (attemptIndex < 4)
    return 200;
  if (attemptIndex < 8)
    return 400;
  return 500;
}

function rejectVenueOrder(
  account: PlatformAccount,
  result: BetResult,
  settlement: Exclude<VenueLegSettlement, "filled">,
): VenueOrder {
  // betting() 把预检 check 放进 request、下单回执放进 response
  const check = result.request as {
    apiBetMoney?: number;
    betMoney?: number;
    odds?: number;
    marketId?: string;
    tokenId?: string;
  } | null | undefined;
  const submitted = result.response as { bookOdds?: number } | null | undefined;
  return {
    provider: account.provider ?? "PredictFun",
    orderId: String(result.orderId ?? "").trim() || `pf-reject-${Date.now()}`,
    odds: Number(submitted?.bookOdds ?? check?.odds) || 0,
    createAt: Number(result.beginTime) || Date.now(),
    betMoney: Number(check?.apiBetMoney ?? check?.betMoney) || 0,
    reward: 0,
    money: 0,
    status: settlement === "unfilled" ? "reject" : "pending",
    game: "",
    match: String(check?.marketId ?? ""),
    bet: "PredictFun",
    item: String(check?.tokenId ?? ""),
  };
}

function findOrderInList(orders: VenueOrder[], orderId: string): VenueOrder | undefined {
  const id = String(orderId ?? "").trim();
  if (!id)
    return undefined;
  return orders.find(o => String(o.orderId ?? "").trim() === id);
}

/**
 * 轮询 Pf_GetOrder 直至 FILLED / 拒单终态 / 超时。
 * 成功 filled 时用 fetchVenueOrders 拉全量更新本地统计（编排层；PF 不再 Client_SaveOrder）。
 */
export async function resolvePredictFunLegOutcome(
  account: PlatformAccount,
  result: BetResult,
  opts?: ResolveLegOutcomeOpts,
): Promise<VenueLegOutcome> {
  const orderId = String(result.orderId ?? "").trim();
  if (!result.success || !orderId) {
    return {
      orders: opts?.orders ? sortVenueOrdersNewestFirst(opts.orders) : [],
      settlement: "unfilled",
    };
  }

  await venueRejectWaitBeforePoll(opts?.rejectWaitSec);

  const attempts = DEFAULT_POLL_ATTEMPTS;
  let lastSettlement: VenueLegSettlement = "timeout";
  let lastOrder: VenueOrder | null = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      // Pf_GetOrder → fetchHousePredictOrderResolved：有 wallet hint 立即 filled/unfilled
      const info = await pfGetOrder(account, orderId);
      lastSettlement = info.settlement;
      if (info.order)
        lastOrder = info.order;

      if (info.settlement === "filled") {
        const pull = opts?.fetchVenueOrders
          ? sortVenueOrdersNewestFirst(await opts.fetchVenueOrders())
          : sortVenueOrdersNewestFirst(
            info.order
              ? [info.order, ...(opts?.orders ?? [])]
              : (opts?.orders ?? []),
          );
        return { orders: pull, settlement: "filled" };
      }

      if (info.settlement === "unfilled") {
        const orders = info.order
          ? sortVenueOrdersNewestFirst([info.order])
          : [rejectVenueOrder(account, result, "unfilled")];
        if (opts?.fetchVenueOrders) {
          try {
            const pulled = sortVenueOrdersNewestFirst(await opts.fetchVenueOrders());
            if (pulled.length)
              return { orders: pulled, settlement: "unfilled" };
          }
          catch {
            /* 用 GetOrder 结果 */
          }
        }
        return { orders, settlement: "unfilled" };
      }
    }
    catch (err) {
      console.warn("[PredictFun] Pf_GetOrder poll failed", err);
    }

    if (i < attempts - 1)
      await sleep(pollIntervalMs(i));
  }

  if (opts?.fetchVenueOrders) {
    try {
      const pulled = sortVenueOrdersNewestFirst(await opts.fetchVenueOrders());
      const hit = findOrderInList(pulled, orderId);
      if (hit?.status === "reject")
        return { orders: pulled, settlement: "unfilled" };
      if (hit?.status === "none")
        return { orders: pulled, settlement: "filled" };
      return { orders: pulled, settlement: "timeout" };
    }
    catch {
      /* fall through */
    }
  }

  if (lastOrder) {
    return {
      orders: sortVenueOrdersNewestFirst([lastOrder]),
      settlement: lastSettlement,
    };
  }

  return {
    orders: [rejectVenueOrder(account, result, "timeout")],
    settlement: "timeout",
  };
}

/** 列表模式：无 POST 确认时按 orderId / orders[0] 判拒 */
export function resolvePredictFunListLegOutcome(
  orders: VenueOrder[],
  result?: BetResult,
): VenueLegOutcome {
  const sorted = sortVenueOrdersNewestFirst(orders);
  const orderId = String(result?.orderId ?? "").trim();
  if (orderId) {
    const hit = findOrderInList(sorted, orderId);
    if (hit) {
      if (hit.status === "reject")
        return { orders: sorted, settlement: "unfilled" };
      if (hit.status === "pending")
        return { orders: sorted, settlement: "timeout" };
      return { orders: sorted, settlement: "filled" };
    }
    // 有 orderId 但列表未命中：勿默认 filled（拉单失败/滞后）
    return { orders: sorted, settlement: "timeout" };
  }
  if (sorted.length > 0 && sorted[0].status === "reject")
    return { orders: sorted, settlement: "unfilled" };
  return { orders: sorted, settlement: "filled" };
}

export async function resolvePredictFunProviderLegOutcome(
  getOrders: (account: PlatformAccount) => Promise<VenueOrder[]>,
  account: PlatformAccount,
  result?: BetResult,
  opts?: ResolveLegOutcomeOpts,
): Promise<VenueLegOutcome> {
  const pull = async () => {
    if (opts?.fetchVenueOrders)
      return sortVenueOrdersNewestFirst(await opts.fetchVenueOrders());
    if (opts?.orders)
      return sortVenueOrdersNewestFirst(opts.orders);
    return sortVenueOrdersNewestFirst(await getOrders(account));
  };

  // 仅 confirmPostAccepted 时进 GetOrder 轮询；拉单用编排 fetchVenueOrders（PF 不 saveOrders）
  if (result && opts?.confirmPostAccepted) {
    return resolvePredictFunLegOutcome(account, result, {
      ...opts,
      fetchVenueOrders: pull,
    });
  }

  return resolvePredictFunListLegOutcome(await pull(), result);
}
