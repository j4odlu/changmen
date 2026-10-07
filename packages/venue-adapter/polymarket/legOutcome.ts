import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { ResolveLegOutcomeOpts, VenueLegOutcome, VenueLegSettlement, VenueOrder } from "../contract";
import { sortVenueOrdersNewestFirst } from "../contract";
import { fetchPolymarketConfirmedTradeForOrder } from "./orders";
import {
  applyPolymarketSettlementToResult,
  applyPolymarketBuyTimeoutPolicy,
  buildPolymarketRejectVenueOrder,
  isPolymarketBetResultFillConfirmed,
  isPolymarketOrderIdRejected,
  interpretPolymarketOrderRow,
} from "./orderStatus";
import { settlePolymarketDelayedOrder } from "./orderSettlement";
import {
  awaitPolymarketSettlementJob,
  getPolymarketSettlementDelayCtx,
} from "./settlementJob";
import { resolvePolymarketDelayedPollOpts } from "./marketDelay";
import type { PolymarketOrderResponseLike, PolymarketPollOutcome } from "./orderTypes";
import { buildPolymarketMatchedBuyVenueOrderForSaveAsync } from "./pmPostFillOrder";
import { readPolymarketOrderWatch } from "./userWs";
import { tracePolymarketOrder } from "./orderTrace";
import { recoverPmUnknownSubmission } from "./pmUnknownSubmitRecovery";
import { finishPmSubmitAttempt, pmSubmitAttemptForOrder } from "./pmSubmitJournal";

export interface PolymarketLegOutcomeDeps {
  fetchVenueOrders: () => Promise<VenueOrder[]>;
}

function pollOutcomeToSettlement(
  outcome: PolymarketPollOutcome,
): VenueLegSettlement {
  if (outcome === "matched")
    return "filled";
  if (outcome === "unfilled")
    return "unfilled";
  return "timeout";
}

function rejectOrders(
  account: PlatformAccount,
  result: BetResult,
): VenueOrder[] {
  return [buildPolymarketRejectVenueOrder(account, result, "unfilled")];
}

async function fetchSortedVenueOrders(
  deps: PolymarketLegOutcomeDeps,
): Promise<VenueOrder[]> {
  return sortVenueOrdersNewestFirst(await deps.fetchVenueOrders());
}

function needsPmSettlementPoll(result: BetResult): boolean {
  if (result.pending)
    return true;
  const status = String(
    (result.response as { status?: string } | undefined)?.status ?? "",
  ).trim().toLowerCase();
  return status === "delayed" || status === "live" || status === "unmatched";
}

/** 买入腿统一收尾：Job 和恢复续查都应用已授权的核验耗尽判拒策略。 */
async function settlePolymarketWithJobFallback(
  account: PlatformAccount,
  orderId: string,
  conditionId?: string,
  submittedAt?: number,
  recoveredRow?: import("./orderTypes").PolymarketOrderRow | null,
): Promise<{ outcome: PolymarketPollOutcome; row: import("./orderTypes").PolymarketOrderRow | null }> {
  const finish = (raw: Awaited<ReturnType<typeof settlePolymarketDelayedOrder>>) => {
    const latest = readPolymarketOrderWatch(orderId, account);
    let evidence = raw;
    if (interpretPolymarketOrderRow(recoveredRow) === "matched") {
      const incomplete = Number(recoveredRow?.original_size) > Number(recoveredRow?.size_matched);
      evidence = incomplete ? { outcome: "timeout", row: recoveredRow ?? null }
        : { outcome: "matched", row: recoveredRow ?? null };
    }
    if (evidence.outcome !== "matched" && latest?.outcome === "matched") {
      const incomplete = Number(latest.row?.size_matched) > 0
        && Number(latest.row?.original_size) > Number(latest.row?.size_matched);
      evidence = incomplete
        ? { outcome: "timeout", row: { ...latest.row, lookupError: "FOK 回执数量不一致，尚未确认整笔成交或未成交" } }
        : { outcome: "matched", row: latest.row };
    }
    const settled = applyPolymarketBuyTimeoutPolicy(evidence);
    if (settled.row?.confirmationBasis === "timeout_policy")
      tracePolymarketOrder(account.accountId, orderId, "decision", { submittedAt, outcome: "timeout_policy_unfilled" });
    return settled;
  };
  const jobResult = await awaitPolymarketSettlementJob(account, orderId);
  if (jobResult)
    return finish(jobResult);
  const ctx = getPolymarketSettlementDelayCtx(account, orderId);
  const poll = ctx?.poll
    ?? await resolvePolymarketDelayedPollOpts(conditionId ?? ctx?.conditionId);
  const settled = await settlePolymarketDelayedOrder(account, orderId, {
    poll, submittedAt: ctx?.submittedAt || submittedAt,
  });
  return finish(settled);
}

async function resolvePolymarketPostAcceptedOutcome(
  account: PlatformAccount,
  result: BetResult,
  deps: PolymarketLegOutcomeDeps,
  conditionId?: string,
): Promise<VenueLegOutcome> {
  // 历史 timeout reject：旧会话残留，清掉错误拒单标记后重新核对原订单。
  if (result.reject === "timeout") {
    result.reject = null;
    result.pending = true;
  }
  else if (result.reject) {
    const settlement = "unfilled" as const;
    return {
      orders: rejectOrders(account, result),
      settlement,
    };
  }

  if (isPolymarketBetResultFillConfirmed(result)) {
    const orderId = String(result.orderId ?? "").trim();
    const fromVenue = await fetchSortedVenueOrders(deps);
    if (fromVenue.some(o => String(o.orderId ?? "").trim() === orderId)) {
      return {
        orders: fromVenue,
        settlement: "filled",
      };
    }
    // trades / RDS 仍滞后：用 POST 成交金额合成，供绑单（placeBet 通常已乐观 save）
    let conditionId = "";
    try {
      const trade = await fetchPolymarketConfirmedTradeForOrder(
        account,
        orderId,
        10 * 60 * 1000,
        "BUY",
      );
      conditionId = String(trade?.market ?? "").trim();
    }
    catch {
      /* 合成单缺 conditionId 时后续 getOrders enrich 仍可补 fee */
    }
    const synthetic = await buildPolymarketMatchedBuyVenueOrderForSaveAsync(
      orderId,
      result.response as PolymarketOrderResponseLike | undefined,
      {
        createAt: Number(result.beginTime) > 0 ? Number(result.beginTime) : Date.now(),
        pmConditionId: conditionId || undefined,
      },
    );
    return {
      orders: synthetic
        ? sortVenueOrdersNewestFirst([synthetic, ...fromVenue])
        : fromVenue,
      settlement: "filled",
    };
  }

  const trade = await fetchPolymarketConfirmedTradeForOrder(
    account,
    result.orderId!,
    10 * 60 * 1000,
  );
  if (trade) {
    return {
      orders: await fetchSortedVenueOrders(deps),
      settlement: "filled",
    };
  }

  const orderId = String(result.orderId ?? "").trim();
  if (orderId && needsPmSettlementPoll(result)) {
    const settled = await settlePolymarketWithJobFallback(account, orderId, conditionId, result.beginTime);
    applyPolymarketSettlementToResult(result, settled.outcome, settled.row);
    const settlement = pollOutcomeToSettlement(settled.outcome);
    if (settlement === "filled") {
      return {
        orders: await fetchSortedVenueOrders(deps),
        settlement,
      };
    }
    if (settlement === "timeout") {
      return {
        orders: settled.row ? await fetchSortedVenueOrders(deps) : [],
        settlement,
      };
    }
    return {
      orders: rejectOrders(account, result),
      settlement,
    };
  }

  const orders = await fetchSortedVenueOrders(deps);
  const listRejected = isPolymarketOrderIdRejected(orders, result.orderId)
    || Boolean(result.reject);
  return {
    orders,
    settlement: listRejected ? "unfilled" : "filled",
  };
}

/**
 * PM 订单状态层：POST 受理后确认 filled / unfilled；本地查询未决则返回 timeout。
 * 编排层（套利收尾、补单 jb、手动下注）统一调用此函数。
 *
 * [changmen 扩展] fill confirmed（matched+takingAmount）→ 直接 filled，不进 delayed poll；
 * 仅拉单一次供绑单。契约见 docs/ARB_VENUE_ORCH_CONTRACT.md。
 * BUY 核验耗尽按用户授权的超时策略判拒；诊断中与官方拒单区分。
 */
export async function resolvePolymarketLegOutcome(
  account: PlatformAccount,
  result: BetResult,
  deps: PolymarketLegOutcomeDeps,
  conditionId?: string,
): Promise<VenueLegOutcome> {
  let recoveredRow = result.orderId ? pmSubmitAttemptForOrder(account, result.orderId)?.evidence?.row : undefined;
  if (result.pmSubmitUnknown) {
    const recovered = result.orderId && await recoverPmUnknownSubmission(account, result.orderId, "BUY", result.pmSubmittedAt ?? result.beginTime);
    if (!recovered)
      return { orders: [], settlement: "timeout" };
    recoveredRow = recovered.row;
    result.pmSubmitUnknown = false;
    result.success = true;
    result.pending = true;
  }
  if (result.pending && result.orderId) {
    const { outcome, row } = await settlePolymarketWithJobFallback(
      account,
      result.orderId,
      conditionId,
      result.pmSubmittedAt ?? result.beginTime,
      recoveredRow,
    );
    applyPolymarketSettlementToResult(result, outcome, row);
    const settlement = pollOutcomeToSettlement(outcome);
    if (settlement !== "timeout") {
      try { finishPmSubmitAttempt(account, result.orderId); } catch { /* 不改变官方终态 */ }
    }
    if (settlement === "filled") {
      return {
        orders: await fetchSortedVenueOrders(deps),
        settlement,
      };
    }
    if (settlement === "timeout") {
      return {
        orders: row ? await fetchSortedVenueOrders(deps) : [],
        settlement,
      };
    }
    return {
      orders: rejectOrders(account, result),
      settlement,
    };
  }

  if (result.success && result.orderId)
    return resolvePolymarketPostAcceptedOutcome(account, result, deps, conditionId);

  const orders = await fetchSortedVenueOrders(deps);
  const listRejected = isPolymarketOrderIdRejected(orders, result.orderId);
  return {
    orders,
    settlement: listRejected ? "unfilled" : "filled",
  };
}

/** PM 列表模式：getOrders + orderId 判拒，不轮询 settle */
export function resolvePolymarketListLegOutcome(
  orders: VenueOrder[],
  result?: BetResult,
): VenueLegOutcome {
  if (result?.pmSubmitUnknown) return { orders: [], settlement: "timeout" };
  const sorted = sortVenueOrdersNewestFirst(orders);
  if (result?.success) {
    const orderId = String(result.orderId ?? "").trim();
    if (orderId) {
      return {
        orders: sorted,
        settlement: isPolymarketOrderIdRejected(sorted, orderId) ? "unfilled" : "filled",
      };
    }
  }
  const listRejected = sorted.length > 0 && sorted[0].status === "reject";
  return {
    orders: sorted,
    settlement: listRejected ? "unfilled" : "filled",
  };
}

export async function resolvePolymarketProviderLegOutcome(
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

  if (result && opts?.confirmPostAccepted) {
    return resolvePolymarketLegOutcome(
      account,
      result,
      { fetchVenueOrders: pull },
      String(opts.pmConditionId ?? "").trim() || undefined,
    );
  }

  return resolvePolymarketListLegOutcome(await pull(), result);
}
