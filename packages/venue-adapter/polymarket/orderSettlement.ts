import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { tracePolymarketOrder } from "./orderTrace";
import type { PolymarketOrderRow, PolymarketPollOutcome } from "./orderTypes";
import { fetchPolymarketConfirmedTradeForOrder } from "./orders";
import { pmCancelOrder } from "./pmClientApi";
import { fetchPolymarketOrderRow, interpretPolymarketOrderRow, isPolymarketRestingNoFill, POLYMARKET_WS_FALLBACK_POLL_OPTS, POLYMARKET_WS_FALLBACK_TRADE_CONFIRM_OPTS } from "./orderStatus";
import { awaitPolymarketOrderWatch, clearPolymarketOrderWatch, readPolymarketOrderWatch, observePolymarketOrderWatch } from "./userWs";

export const POLYMARKET_FOK_RESTING_GRACE_MS = 4_000;
export const POLYMARKET_FOK_RESTING_GRACE_INTERVAL_MS = 1_000;
export const POLYMARKET_FOK_POST_CANCEL_ATTEMPTS = 4;
export const POLYMARKET_FOK_POST_CANCEL_INTERVAL_MS = 500;
const READ_TIMEOUT_MS = 3_000;
type Settlement = { outcome: PolymarketPollOutcome; row: PolymarketOrderRow | null };

function wait(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)));
}

async function bounded<T>(job: () => Promise<T>, deadline: number): Promise<T> {
  const ms = Math.min(READ_TIMEOUT_MS, deadline - Date.now());
  if (ms <= 0)
    throw new Error("PM 订单核验超时");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      job(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("PM 查询超时")), ms);
      }),
    ]);
  }
  finally {
    clearTimeout(timer);
  }
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : "PM 查询失败";
}

/** 查询错误保留为错误，不能用空数组伪造「无成交」。两个通道并行。 */
async function readEvidence(account: PlatformAccount, id: string, side: "BUY" | "SELL", lookbackMs: number, deadline: number) {
  const startedAt = Date.now();
  const [order, trade] = await Promise.allSettled([
    bounded(() => fetchPolymarketOrderRow(account, id), deadline),
    bounded(() => fetchPolymarketConfirmedTradeForOrder(account, id, lookbackMs, side, true), deadline),
  ]);
  const row = order.status === "fulfilled" ? order.value : null;
  const fill = trade.status === "fulfilled" ? trade.value : null;
  tracePolymarketOrder(account.accountId, id, "lookup", { startedAt,
    orderRead: order.status === "rejected" ? "error" : row ? "found" : "empty",
    tradeRead: trade.status === "rejected" ? "error" : fill ? "found" : "empty",
    status: row?.status,
  });
  if (interpretPolymarketOrderRow(row) === "matched")
    return { outcome: "matched" as const, row, healthy: order.status === "fulfilled" && trade.status === "fulfilled" };
  if (fill) {
    return { outcome: "matched" as const, row: {
      ...row,
      status: String(fill.status ?? "MATCHED"), size_matched: String(fill.size ?? ""),
      associate_trades: fill.id ? [String(fill.id)] : undefined,
    }, healthy: true };
  }
  const state = interpretPolymarketOrderRow(row);
  const healthy = order.status === "fulfilled" && trade.status === "fulfilled";
  const errors = [order, trade].flatMap(r => r.status === "rejected" ? [diagnostic(r.reason)] : []);
  return {
    outcome: state === "matched" ? "matched" as const
      : state === "unfilled" && healthy ? "unfilled" as const : "timeout" as const,
    row: errors.length ? { ...row, lookupError: errors.join("; ") } : row,
    healthy,
  };
}

/** [changmen 扩展] 仅对明确挂簿的原单撤单；delayed/查空不能撤。 */
export async function finalizePolymarketFokRestingOrder(
  account: PlatformAccount,
  orderId: string,
  row: PolymarketOrderRow | null,
  opts?: {
    side?: "BUY" | "SELL"; lookbackMs?: number;
    graceMs?: number; graceIntervalMs?: number;
    postCancelAttempts?: number; postCancelIntervalMs?: number;
    deadline?: number; stopped?: () => boolean;
  },
): Promise<Settlement> {
  const side = opts?.side ?? "BUY";
  const lookbackMs = opts?.lookbackMs ?? 10 * 60 * 1000;
  const deadline = opts?.deadline ?? Number.POSITIVE_INFINITY;
  const active = () => Date.now() < deadline && !opts?.stopped?.();
  let last = row;
  if (interpretPolymarketOrderRow(last) === "matched")
    return { outcome: "matched", row: last };
  const graceEnd = Math.min(deadline, Date.now() + (opts?.graceMs ?? POLYMARKET_FOK_RESTING_GRACE_MS));
  while (active() && Date.now() < graceEnd) {
    const evidence = await readEvidence(account, orderId, side, lookbackMs, deadline);
    last = evidence.row;
    if (evidence.outcome !== "timeout")
      return { outcome: evidence.outcome, row: last };
    await wait(Math.min(opts?.graceIntervalMs ?? 1000, Math.max(0, graceEnd - Date.now())));
  }
  let canceled = false;
  if (active() && isPolymarketRestingNoFill(last) && !last?.lookupError) {
    try {
      const response = await bounded(() => pmCancelOrder<{ canceled?: string[] }>(account, orderId), deadline);
      canceled = response?.canceled?.some(id => id.toLowerCase() === orderId.toLowerCase()) === true;
    }
    catch (error) {
      last = { ...last, lookupError: diagnostic(error) };
    }
  }
  const attempts = opts?.postCancelAttempts ?? POLYMARKET_FOK_POST_CANCEL_ATTEMPTS;
  for (let i = 0; i < attempts && active(); i++) {
    const evidence = await readEvidence(account, orderId, side, lookbackMs, deadline);
    last = evidence.row;
    if (evidence.outcome !== "timeout")
      return { outcome: evidence.outcome, row: last };
    // 明确撤单 ACK + 成功复核无成交。仍返回 live/delayed 则保留矛盾待核对。
    if (canceled && evidence.healthy && last == null)
      return { outcome: "unfilled", row: { id: orderId, status: "canceled", size_matched: "0" } };
    const ws = readPolymarketOrderWatch(orderId, account);
    if (ws?.outcome === "matched" || (ws?.outcome === "unfilled" && evidence.healthy && last == null))
      return { outcome: ws.outcome, row: ws.row };
    if (i < attempts - 1)
      await wait(Math.min(opts?.postCancelIntervalMs ?? 500, Math.max(0, deadline - Date.now())));
  }
  return { outcome: "timeout", row: last };
}

export async function settlePolymarketDelayedOrder(
  account: PlatformAccount,
  orderId: string,
  opts?: {
    side?: "BUY" | "SELL";
    submittedAt?: number;
    poll?: { initialDelayMs?: number; intervalMs?: number; maxAttempts?: number };
    tradeConfirm?: { lookbackMs?: number; retryMs?: number; maxRetries?: number };
    fokGrace?: { graceMs?: number; graceIntervalMs?: number; postCancelAttempts?: number; postCancelIntervalMs?: number };
  },
): Promise<Settlement> {
  const startedAt = Date.now();
  const submittedAt = Number(opts?.submittedAt) || startedAt;
  const poll = { ...POLYMARKET_WS_FALLBACK_POLL_OPTS, ...opts?.poll };
  const tradeConfirm = { ...POLYMARKET_WS_FALLBACK_TRADE_CONFIRM_OPTS, ...opts?.tradeConfirm };
  const remainingDelay = Math.max(0, submittedAt + poll.initialDelayMs - startedAt);
  // 恢复旧版有限次数重试，不再用新增的 15 秒总预算提前截断核验。
  const deadline = Number.POSITIVE_INFINITY;
  const lookbackMs = Math.max(opts?.tradeConfirm?.lookbackMs ?? 600_000, Date.now() - submittedAt + 60_000);
  const side = opts?.side ?? "BUY";
  let stopped = false;
  // WS 与 REST 同时工作；一次等待超时不注销原单跟踪。
  const ws = awaitPolymarketOrderWatch(orderId, account).catch(() => null);
  const rest = async (): Promise<Settlement> => {
    await wait(remainingDelay);
    const attempts = poll.maxAttempts;
    let last: PolymarketOrderRow | null = null;
    for (let i = 0; i < attempts && Date.now() < deadline && !stopped; i++) {
      const evidence = await readEvidence(account, orderId, side, lookbackMs, deadline);
      last = evidence.row;
      if (evidence.outcome !== "timeout")
        return { outcome: evidence.outcome, row: last };
      const observed = readPolymarketOrderWatch(orderId, account);
      if (observed?.outcome === "matched" || (observed?.outcome === "unfilled" && evidence.healthy && last == null))
        return { outcome: observed.outcome, row: observed.row };
      if (isPolymarketRestingNoFill(last))
        break;
      if (i < attempts - 1)
        await wait(poll.intervalMs);
    }
    // 恢复原成交复查次数和间隔，同时继续接收迟到的原单回执。
    for (let i = 0; i < tradeConfirm.maxRetries && !stopped; i++) {
      try {
        const trade = await bounded(() => fetchPolymarketConfirmedTradeForOrder(account, orderId, lookbackMs, side, true), deadline);
        if (trade)
          return { outcome: "matched", row: { ...last, status: String(trade.status ?? "MATCHED"), size_matched: String(trade.size ?? ""), associate_trades: trade.id ? [String(trade.id)] : undefined } };
      }
      catch (error) {
        last = { ...last, lookupError: diagnostic(error) };
      }
      const observed = readPolymarketOrderWatch(orderId, account);
      if (observed?.outcome === "matched")
        return { outcome: observed.outcome, row: observed.row };
      if (observed?.outcome === "unfilled" && observed.row?.size_matched != null
        && String(observed.row.size_matched).trim() !== "" && Number(observed.row.size_matched) === 0
        && !observed.row.associate_trades?.length) {
        const evidence = await readEvidence(account, orderId, side, lookbackMs, Date.now() + READ_TIMEOUT_MS);
        if (evidence.outcome === "matched")
          return { outcome: "matched", row: evidence.row };
        const latest = readPolymarketOrderWatch(orderId, account);
        return latest?.outcome === "matched" ? { outcome: latest.outcome, row: latest.row }
          : { outcome: "unfilled", row: observed.row };
      }
      if (i < tradeConfirm.maxRetries - 1)
        await wait(tradeConfirm.retryMs);
    }
    return finalizePolymarketFokRestingOrder(account, orderId, last, {
      ...opts?.fokGrace, side, lookbackMs, deadline, stopped: () => stopped,
    });
  };
  // WS 明确零成交取消触发立即复核；不等轮询窗口，也不要求 REST 重复返回取消行。
  // 短复核用于发现与取消帧竞争的成交证据，最长 READ_TIMEOUT_MS。
  let resolveWs!: (result: Settlement) => void;
  const wsTerminal = new Promise<Settlement>(resolve => { resolveWs = resolve; });
  let checking = false;
  let checkAgain = false;
  let canceled: Settlement | null = null;
  const reconcile = async () => {
    if (stopped)
      return;
    if (checking) {
      checkAgain = true;
      return;
    }
    checking = true;
    try {
      do {
        checkAgain = false;
        const evidence = await readEvidence(account, orderId, side, lookbackMs, Date.now() + READ_TIMEOUT_MS);
        if (stopped)
          return;
        const latest = readPolymarketOrderWatch(orderId, account);
        if (evidence.outcome === "matched") {
          resolveWs({ outcome: "matched", row: evidence.row });
          return;
        }
        else if (latest?.outcome === "matched") {
          resolveWs({ outcome: "matched", row: latest.row });
          return;
        }
        else if (canceled) {
          resolveWs(canceled);
          return;
        }
        else if (evidence.outcome === "unfilled") {
          resolveWs({ outcome: "unfilled", row: evidence.row });
          return;
        }
      } while (checkAgain && !stopped);
    }
    finally {
      checking = false;
    }
  };
  const onResult = (value: Awaited<typeof ws>) => {
    if (stopped)
      return;
    if (value?.outcome === "matched" && !(Number(value.row?.original_size) > Number(value.row?.size_matched)))
      resolveWs({ outcome: "matched", row: value.row });
    if (value?.outcome === "unfilled" && value.row?.size_matched != null
      && String(value.row.size_matched).trim() !== "" && Number(value.row.size_matched) === 0
      && !value.row.associate_trades?.length) {
      canceled = { outcome: "unfilled", row: value.row };
      void reconcile();
    }
  };
  const unsubscribe = observePolymarketOrderWatch(account, orderId, event => {
    if (event === "connected")
      void reconcile(); // 重连后立即补查，不假设服务端会重放断线期间的消息。
    else
      onResult(readPolymarketOrderWatch(orderId, account));
  });
  void ws.then(onResult);
  let result: Settlement;
  try {
    result = await Promise.race([rest(), wsTerminal]);
  }
  finally {
    stopped = true;
    unsubscribe();
  }
  const filled = Number(result.row?.size_matched);
  const original = Number(result.row?.original_size);
  // FOK 业务只有整笔成交/未成交；数量不一致的回执属于核验异常，不创建部分成交状态。
  if (result.outcome === "matched" && filled > 0 && original > filled)
    result = { outcome: "timeout", row: { ...result.row, lookupError: "FOK 回执数量不一致，尚未确认整笔成交或未成交" } };
  tracePolymarketOrder(account.accountId, orderId, "decision", { submittedAt, startedAt, outcome: result.outcome, status: result.row?.status });
  if (result.outcome !== "timeout")
    clearPolymarketOrderWatch(orderId);
  return result;
}
