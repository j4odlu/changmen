import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { PolymarketOrderRow, PolymarketPollOutcome } from "./orderTypes";
import { fetchPolymarketConfirmedTradeForOrder } from "./orders";
import { pmCancelOrder } from "./pmClientApi";
import {
  POLYMARKET_WS_FALLBACK_POLL_OPTS,
  POLYMARKET_WS_FALLBACK_TRADE_CONFIRM_OPTS,
  fetchPolymarketOrderRow,
  interpretPolymarketOrderRow,
  isPolymarketDelayLookupPending,
  isPolymarketRestingNoFill,
  pollPolymarketDelayedOrder,
} from "./orderStatus";
import { awaitPolymarketOrderWatch, clearPolymarketOrderWatch } from "./userWs";

function wait(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

/** FOK：delay 撮合试完后，给系统 kill 的短窗口（官网无 SLA，取数秒） */
export const POLYMARKET_FOK_RESTING_GRACE_MS = 4_000;
export const POLYMARKET_FOK_RESTING_GRACE_INTERVAL_MS = 1_000;
export const POLYMARKET_FOK_POST_CANCEL_ATTEMPTS = 4;
export const POLYMARKET_FOK_POST_CANCEL_INTERVAL_MS = 500;

async function lookupTradeMatched(
  account: PlatformAccount,
  orderId: string,
  side: "BUY" | "SELL",
  lookbackMs: number,
): Promise<{ outcome: "matched"; row: PolymarketOrderRow } | null> {
  const trade = await fetchPolymarketConfirmedTradeForOrder(
    account,
    orderId,
    lookbackMs,
    side,
  );
  if (!trade)
    return null;
  return {
    outcome: "matched",
    row: {
      status: "MATCHED",
      size_matched: String(trade.size ?? ""),
      associate_trades: trade.id ? [String(trade.id)] : undefined,
    },
  };
}

/**
 * FOK 在官方 delay 窗之后的收尾。调用方须已等满 `sd` + 查询滞后。
 * [A8 可证实] 无。官方 Order Lifecycle：窗内不可撤（delayed / 查不到行）；窗后 live/unmatched 可撤。
 * 只有明确 canceled/expired 且无成交才是 unfilled；本地复核耗尽仍无终态则 timeout。
 */
export async function finalizePolymarketFokRestingOrder(
  account: PlatformAccount,
  orderId: string,
  row: PolymarketOrderRow | null,
  opts?: {
    side?: "BUY" | "SELL";
    lookbackMs?: number;
    graceMs?: number;
    graceIntervalMs?: number;
    postCancelAttempts?: number;
    postCancelIntervalMs?: number;
  },
): Promise<{ outcome: PolymarketPollOutcome; row: PolymarketOrderRow | null }> {
  const side = opts?.side ?? "BUY";
  const lookbackMs = opts?.lookbackMs ?? 10 * 60 * 1000;
  const graceMs = opts?.graceMs ?? POLYMARKET_FOK_RESTING_GRACE_MS;
  const graceIntervalMs = opts?.graceIntervalMs ?? POLYMARKET_FOK_RESTING_GRACE_INTERVAL_MS;
  const postCancelAttempts = opts?.postCancelAttempts ?? POLYMARKET_FOK_POST_CANCEL_ATTEMPTS;
  const postCancelIntervalMs = opts?.postCancelIntervalMs ?? POLYMARKET_FOK_POST_CANCEL_INTERVAL_MS;

  let last = row;
  const opening = interpretPolymarketOrderRow(last);
  if (opening === "matched")
    return { outcome: "matched", row: last };
  if (opening === "unfilled")
    return { outcome: "unfilled", row: last };

  const needsGrace = isPolymarketRestingNoFill(last) || isPolymarketDelayLookupPending(last);
  if (needsGrace) {
    const graceDeadline = Date.now() + graceMs;
    while (Date.now() < graceDeadline) {
      const traded = await lookupTradeMatched(account, orderId, side, lookbackMs);
      if (traded)
        return traded;
      last = await fetchPolymarketOrderRow(account, orderId);
      const state = interpretPolymarketOrderRow(last);
      if (state === "matched")
        return { outcome: "matched", row: last };
      if (state === "unfilled")
        return { outcome: "unfilled", row: last };
      if (!isPolymarketRestingNoFill(last) && !isPolymarketDelayLookupPending(last))
        break;
      await wait(graceIntervalMs);
    }
  }

  // 官方 delayed / 查不到行不是可撤挂单；只对明确 live/unmatched 发 cancel。
  if (isPolymarketRestingNoFill(last)) {
    try {
      await pmCancelOrder(account, orderId);
    }
    catch {
      /* cancel 失败仍复核；可能已系统 cancel 或竞态成交 */
    }
  }

  for (let i = 0; i < postCancelAttempts; i++) {
    const traded = await lookupTradeMatched(account, orderId, side, lookbackMs);
    if (traded)
      return traded;
    last = await fetchPolymarketOrderRow(account, orderId);
    const state = interpretPolymarketOrderRow(last);
    if (state === "matched")
      return { outcome: "matched", row: last };
    if (state === "unfilled")
      return { outcome: "unfilled", row: last };
    if (i < postCancelAttempts - 1)
      await wait(postCancelIntervalMs);
  }

  const traded = await lookupTradeMatched(account, orderId, side, lookbackMs);
  if (traded)
    return traded;
  last = await fetchPolymarketOrderRow(account, orderId);
  const state = interpretPolymarketOrderRow(last);
  if (state === "matched")
    return { outcome: "matched", row: last };
  if (state === "unfilled")
    return { outcome: "unfilled", row: last };
  // 官方没有 timeout 订单态；本地复核耗尽且仍无明确取消/成交，只能保持待确认。
  return { outcome: "timeout", row: last };
}

async function settlePolymarketDelayedOrderViaRest(
  account: PlatformAccount,
  orderId: string,
  opts?: {
    side?: "BUY" | "SELL";
    poll?: { initialDelayMs?: number; intervalMs?: number; maxAttempts?: number };
    tradeConfirm?: { lookbackMs?: number; retryMs?: number; maxRetries?: number };
  },
): Promise<{ outcome: PolymarketPollOutcome; row: PolymarketOrderRow | null }> {
  const side = opts?.side ?? "BUY";
  const pollOpts = { ...POLYMARKET_WS_FALLBACK_POLL_OPTS, ...opts?.poll };
  const tradeConfirm = { ...POLYMARKET_WS_FALLBACK_TRADE_CONFIRM_OPTS, ...opts?.tradeConfirm };
  const { outcome, row } = await pollPolymarketDelayedOrder(account, orderId, pollOpts);
  if (outcome === "matched")
    return { outcome, row };

  for (let i = 0; i < tradeConfirm.maxRetries; i++) {
    const trade = await fetchPolymarketConfirmedTradeForOrder(
      account,
      orderId,
      tradeConfirm.lookbackMs,
      side,
    );
    if (trade) {
      return {
        outcome: "matched",
        row: {
          status: "MATCHED",
          size_matched: String(trade.size ?? ""),
          associate_trades: trade.id ? [String(trade.id)] : undefined,
        },
      };
    }
    if (i < tradeConfirm.maxRetries - 1)
      await wait(tradeConfirm.retryMs);
  }

  return { outcome, row };
}

export async function settlePolymarketDelayedOrder(
  account: PlatformAccount,
  orderId: string,
  opts?: {
    side?: "BUY" | "SELL";
    poll?: { initialDelayMs?: number; intervalMs?: number; maxAttempts?: number };
    tradeConfirm?: { lookbackMs?: number; retryMs?: number; maxRetries?: number };
    fokGrace?: {
      graceMs?: number;
      graceIntervalMs?: number;
      postCancelAttempts?: number;
      postCancelIntervalMs?: number;
    };
  },
): Promise<{ outcome: PolymarketPollOutcome; row: PolymarketOrderRow | null }> {
  const wsResult = await awaitPolymarketOrderWatch(orderId);
  clearPolymarketOrderWatch(orderId);
  // 官方：WS matched 可采信；WS unfilled 仍须 REST/trades 权威确认（防误杀）
  if (wsResult?.outcome === "matched")
    return { outcome: "matched", row: wsResult.row };

  const rest = await settlePolymarketDelayedOrderViaRest(account, orderId, opts);
  if (rest.outcome === "matched")
    return rest;
  // REST 已确认取消且未挂簿：直接未成交。timeout / delayed / 404 / 仍挂簿：FOK 收尾（窗后可撤）
  if (
    rest.outcome === "unfilled"
    && !isPolymarketRestingNoFill(rest.row)
    && !isPolymarketDelayLookupPending(rest.row)
  ) {
    return rest;
  }

  const lookbackMs = {
    ...POLYMARKET_WS_FALLBACK_TRADE_CONFIRM_OPTS,
    ...opts?.tradeConfirm,
  }.lookbackMs;
  const fin = await finalizePolymarketFokRestingOrder(account, orderId, rest.row, {
    side: opts?.side ?? "BUY",
    lookbackMs,
    ...opts?.fokGrace,
  });
  return fin;
}
