import { normalizeEpochMs } from "@changmen/shared/time/match_time";
import type { LimitlessGroupMarket, LimitlessOrderbook } from "./parse";
import { limitlessPluginGet } from "./transport";

export const LIMITLESS_API = "https://api.limitless.exchange";
export const LIMITLESS_WS = "wss://ws.limitless.exchange/markets";

/** [changmen 扩展] /esports 页面 ID，来自 GET /market-pages/by-path?path=/esports */
export const LIMITLESS_ESPORTS_PAGE_ID = "f2a04a4e-580a-4cd1-bcc9-c23ed9ff8916";

const COLLECT_PAST_MS = 6 * 3600 * 1000;
const COLLECT_FUTURE_MS = 3600 * 1000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

export const LIMITLESS_COLLECT_PAST_MS = COLLECT_PAST_MS;
export const LIMITLESS_COLLECT_FUTURE_MS = COLLECT_FUTURE_MS;

export function limitlessCollectStartTimeAllowed(startMs: number): boolean {
  const ms = normalizeEpochMs(startMs);
  if (!ms)
    return true;
  const now = Date.now();
  return ms >= now - COLLECT_PAST_MS && ms <= now + COLLECT_FUTURE_MS;
}

interface ListMarketsResponse {
  data?: LimitlessGroupMarket[];
  pagination?: { page?: number; totalPages?: number };
}

export async function fetchLimitlessEsportsGroups(): Promise<LimitlessGroupMarket[]> {
  const groups: LimitlessGroupMarket[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
      sort: "deadline",
    });
    const res = await limitlessPluginGet<ListMarketsResponse>(
      `${LIMITLESS_API}/market-pages/${LIMITLESS_ESPORTS_PAGE_ID}/markets?${params.toString()}`,
    );
    const batch = Array.isArray(res?.data) ? res.data : [];
    groups.push(...batch);
    const totalPages = Number(res?.pagination?.totalPages ?? page);
    if (page >= totalPages || !batch.length)
      break;
  }
  return groups;
}

export async function fetchLimitlessOrderbook(slug: string): Promise<LimitlessOrderbook | null> {
  if (!slug)
    return null;
  try {
    return await limitlessPluginGet<LimitlessOrderbook>(
      `${LIMITLESS_API}/markets/${encodeURIComponent(slug)}/orderbook`,
    );
  }
  catch {
    return null;
  }
}

export interface LimitlessOrderbookUpdate {
  marketSlug?: string;
  orderbook?: LimitlessOrderbook;
  timestamp?: string;
}
