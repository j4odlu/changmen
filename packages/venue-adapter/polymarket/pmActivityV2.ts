import type { PolymarketActivityTradeRow } from "./pmActivity";
import { POLYMARKET_DATA_API } from "./api";
import { polymarketPluginGet } from "./transport";

/** Public Data API v2 contract; keep wire names out of cost/matching code. */
export interface PolymarketActivityQuery {
  /** Page size, not a cap on the complete result. */
  limit?: number;
  side?: "BUY" | "SELL";
  startSec?: number;
  endSec?: number;
  maxPages?: number;
  maxRows?: number;
  timeoutMs?: number;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Polymarket activity v2 object");
  return value as Record<string, unknown>;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizePolymarketActivityV2Row(value: unknown): PolymarketActivityTradeRow {
  const row = record(value);
  // Combo economics belong to the combo API, not single-market cost matching.
  if (row.is_combo === true)
    return { type: "COMBO" };
  return {
    proxyWallet: text(row.proxy_wallet),
    timestamp: numeric(row.timestamp),
    conditionId: text(row.condition_id),
    type: text(row.type),
    size: numeric(row.size),
    usdcSize: numeric(row.usdc_size),
    price: numeric(row.price),
    asset: text(row.token_id),
    side: text(row.side),
    transactionHash: text(row.transaction_hash),
    title: text(row.title),
    outcome: text(row.outcome),
  };
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.min(Math.max(Math.floor(Number(value)), 1), maximum)
    : fallback;
}

function retryDelay(error: unknown, attempt: number): number | null {
  if (!error || typeof error !== "object")
    return null;
  const err = error as Record<string, unknown>;
  const response = err.response && typeof err.response === "object"
    ? err.response as Record<string, unknown>
    : undefined;
  const body = response?.data && typeof response.data === "object"
    ? response.data as Record<string, unknown>
    : err;
  const status = Number(response?.status ?? err.status);
  if (![429, 503].includes(status) && !["rate_limited", "request_timeout", "dependency_unavailable"].includes(String(body.code)))
    return null;
  if (body.retryable === false)
    return null;
  const rawHeaders = response?.headers ?? err.headers;
  const headers = rawHeaders && typeof rawHeaders === "object" ? rawHeaders as Record<string, unknown> : undefined;
  const after = (typeof headers?.get === "function" ? headers.get("retry-after") : undefined)
    ?? headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (after != null) {
    const seconds = Number(after);
    const date = Date.parse(String(after));
    if (Number.isFinite(seconds) && seconds >= 0)
      return seconds * 1000;
    if (Number.isFinite(date))
      return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    throw new Error("Polymarket activity v2 deadline exceeded");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Polymarket activity v2 deadline exceeded")), remaining);
      }),
    ]);
  }
  finally {
    clearTimeout(timer);
  }
}

async function requestPage(url: string, deadline: number): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await beforeDeadline(polymarketPluginGet<unknown>(url), deadline);
      const body = record(raw);
      if (typeof body.error === "string" || typeof body.code === "string")
        throw body;
      return body;
    }
    catch (error) {
      const delay = retryDelay(error, attempt);
      if (attempt >= 2 || delay == null || Date.now() + delay >= deadline)
        throw error;
      await beforeDeadline(new Promise(resolve => setTimeout(resolve, delay)), deadline);
    }
  }
}

/**
 * Throws on failure/truncation: callers must never use a partial page walk as
 * the total cash cost of a trade. No automatic v1 fallback (v1 retires 2026-10-24).
 * https://docs.polymarket.com/api-reference/feeds/list-account-activity
 */
export async function fetchPolymarketActivityV2(
  user: string,
  options: PolymarketActivityQuery = {},
): Promise<PolymarketActivityTradeRow[]> {
  const maxPages = bounded(options.maxPages, 10, 20);
  const maxRows = bounded(options.maxRows, 10000, 20000);
  const deadline = Date.now() + bounded(options.timeoutMs, 15000, 30000);
  const qs = new URLSearchParams({
    user,
    limit: String(bounded(options.limit, 200, 1000)),
    type: "TRADE",
    side: options.side === "SELL" ? "SELL" : "BUY",
    sort_by: "TIMESTAMP",
    sort_direction: "DESC",
  });
  for (const [key, value] of [["start", options.startSec], ["end", options.endSec]] as const) {
    if (Number.isFinite(value) && Number(value) > 0)
      qs.set(key, String(Math.floor(Number(value))));
  }
  const rows: PolymarketActivityTradeRow[] = [];
  const cursors = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    if (Date.now() >= deadline)
      throw new Error("Polymarket activity v2 deadline exceeded");
    const body = record(await requestPage(`${POLYMARKET_DATA_API}/v2/activity?${qs}`, deadline));
    if (!Array.isArray(body.data))
      throw new Error("Invalid Polymarket activity v2 data envelope");
    const pagination = record(body.pagination);
    const cursor = pagination.next_cursor;
    if (typeof pagination.has_more !== "boolean"
      || !(cursor === null || (typeof cursor === "string" && cursor.length > 0))
      || pagination.has_more !== (cursor !== null)) {
      throw new Error("Invalid Polymarket activity v2 pagination");
    }
    if (rows.length + body.data.length > maxRows)
      throw new Error("Polymarket activity v2 row limit exceeded; partial data discarded");
    rows.push(...body.data.map(normalizePolymarketActivityV2Row));
    if (cursor === null)
      return rows;
    if (cursors.has(cursor as string) || !body.data.length)
      throw new Error("Polymarket activity v2 cursor did not advance");
    cursors.add(cursor as string);
    qs.set("cursor", cursor as string);
  }
  throw new Error("Polymarket activity v2 page limit exceeded; partial data discarded");
}
