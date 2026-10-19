import { normalizeEpochMs } from "@changmen/shared/time/match_time";

import type { PredictOrderbookData } from "./parse";
import {
  predictFunHttpGet,
  resolvePredictFunApiKey,
} from "./transport";
import { resolvePfHttpMode } from "./pfTransportMode";

export { resolvePredictFunApiKey } from "./transport";

/**
 * Categories 列表形状（诊断/残留 HTTP 用）。
 * 生产 discovery 只跑 VPS `predictfun-collector`；浏览器 collect 不扫盘。
 */
export interface PredictCategory {
  id?: number;
  slug?: string;
  title?: string;
  status?: string;
  marketVariant?: string;
  startsAt?: string;
  endsAt?: string;
  tags?: Array<{ id?: string; name?: string }>;
  teams?: Array<{ id?: number; name?: string; league?: string }>;
  markets?: unknown[];
}

/** [Predict 官方] 主网需 API Key；测试网用 VITE_PREDICT_FUN_API_BASE=https://api-testnet.predict.fun */
export const PREDICT_FUN_API = (
  typeof import.meta !== "undefined" && import.meta.env?.VITE_PREDICT_FUN_API_BASE
) || "https://api.predict.fun";

export const PREDICT_FUN_WS = "wss://ws.predict.fun/ws";

const COLLECT_PAST_MS = 0;
/** 与 VPS collector 一致：进行中不限过去 + 开赛未来 1h */
const COLLECT_FUTURE_MS = 3600 * 1000;
const PAGE_SIZE = 50;
const MAX_PAGES = 5;

export const PREDICT_FUN_COLLECT_PAST_MS = COLLECT_PAST_MS;
export const PREDICT_FUN_COLLECT_FUTURE_MS = COLLECT_FUTURE_MS;

/** 官方 /v1/tags：Esports */
export const PREDICT_FUN_TAG_ESPORTS = "83";

interface PredictListResponse<T> {
  success?: boolean;
  cursor?: string;
  data?: T[];
}

function predictHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = resolvePredictFunApiKey();
  if (apiKey)
    headers["x-api-key"] = apiKey;
  return headers;
}

export function predictCollectStartTimeAllowed(startMs: number): boolean {
  const ms = normalizeEpochMs(startMs);
  if (!ms)
    return true;
  return ms <= Date.now() + COLLECT_FUTURE_MS;
}

export async function fetchPredictCategories(params: {
  marketVariant?: string;
  status?: string;
  tagIds?: string;
} = {}): Promise<PredictCategory[]> {
  const categories: PredictCategory[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const qs = new URLSearchParams({
      first: String(PAGE_SIZE),
      status: params.status ?? "OPEN",
    });
    const tagIds = params.tagIds ?? (params.marketVariant ? undefined : PREDICT_FUN_TAG_ESPORTS);
    if (tagIds)
      qs.set("tagIds", tagIds);
    if (params.marketVariant)
      qs.set("marketVariant", params.marketVariant);
    if (after)
      qs.set("after", after);
    const res = await predictFunHttpGet<PredictListResponse<PredictCategory>>(
      `${PREDICT_FUN_API}/v1/categories?${qs.toString()}`,
      predictHeaders(),
    );
    const batch = Array.isArray(res?.data) ? res.data : [];
    categories.push(...batch);
    after = res?.cursor ? String(res.cursor) : undefined;
    if (!after || !batch.length)
      break;
  }
  return categories;
}

export async function fetchPredictOrderbook(marketId: string | number): Promise<PredictOrderbookData | null> {
  const id = String(marketId ?? "").trim();
  if (!id)
    return null;
  const apiKey = resolvePredictFunApiKey();
  // 官方主网 orderbook 强制 x-api-key；无 Key 时 direct 必 401，错误曾被吞成「orderbook 为空」
  if (!apiKey && resolvePfHttpMode() === "direct") {
    throw new Error(
      `Predict.fun orderbook 需要 API Key（market ${id}；当前 HTTP=direct 且未配置 VITE_PREDICT_FUN_API_KEY，请改 VPS 中继或补 Key）`,
    );
  }
  try {
    const res = await predictFunHttpGet<{ success?: boolean; data?: PredictOrderbookData; message?: string; error?: string }>(
      `${PREDICT_FUN_API}/v1/markets/${encodeURIComponent(id)}/orderbook`,
      predictHeaders(),
    );
    if (res?.data)
      return res.data;
    const hint = String(res?.message || res?.error || "").trim();
    throw new Error(
      hint
        ? `Predict.fun orderbook 无 data（market ${id}）：${hint}`
        : `Predict.fun orderbook 无 data（market ${id}）`,
    );
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 已带 market 上下文则原样抛，避免双重包装
    if (/orderbook/i.test(msg) && msg.includes(id))
      throw err instanceof Error ? err : new Error(msg);
    throw new Error(`Predict.fun orderbook 拉取失败（market ${id}）：${msg}`);
  }
}

export async function fetchPredictOrderbooks(
  marketIds: Array<string | number>,
  concurrency = 8,
): Promise<Record<string, PredictOrderbookData>> {
  const unique = [...new Set(marketIds.map(id => String(id)).filter(Boolean))];
  const out: Record<string, PredictOrderbookData> = {};
  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const rows = await Promise.all(chunk.map(async (id) => {
      const book = await fetchPredictOrderbook(id);
      return { id, book };
    }));
    for (const row of rows) {
      if (row.book)
        out[row.id] = row.book;
    }
  }
  return out;
}

export interface PredictMarketDetail {
  id?: number;
  feeRateBps?: number;
  decimalPrecision?: number;
  isNegRisk?: boolean;
  isYieldBearing?: boolean;
  tradingStatus?: string;
  status?: string;
  outcomes?: Array<{
    name?: string;
    indexSet?: number;
    onChainId?: string;
  }>;
}

export async function fetchPredictMarket(marketId: string | number): Promise<PredictMarketDetail | null> {
  const id = String(marketId ?? "").trim();
  if (!id)
    return null;
  try {
    const res = await predictFunHttpGet<{ success?: boolean; data?: PredictMarketDetail }>(
      `${PREDICT_FUN_API}/v1/markets/${encodeURIComponent(id)}`,
      predictHeaders(),
    );
    return res?.data ?? null;
  }
  catch {
    return null;
  }
}
