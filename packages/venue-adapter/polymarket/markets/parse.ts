/**
 * Polymarket 浏览器侧 **报价 / 订单工具**（非电竞 discovery）。
 *
 * - **Discovery / 映射权威**：`server/collectors/polymarket-esports/parse.js`
 *   （Gamma → platform_* + MarketIndex）。浏览器 `collect.ts` 只吃 Index + Market WS → fo。
 * - **本文件职责**：decimalOdds、book best ask/bid、卖出估值、订单展示上下文、
 *   Gamma 单盘字段解析（`parseJsonArray` / `polymarketOrderContextFromMarket`）。
 * - 禁止在此恢复 `buildPolymarketMappedMarket`（防双源回潮）。
 * - Transport（direct / vps / extension）与本文件正交，见 `pmTransportMode.ts`。
 */
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";

export interface PolymarketRawMarket {
  id?: string | number;
  condition_id?: string;
  conditionId?: string;
  question?: string;
  title?: string;
  slug?: string;
  market_slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  accepting_orders?: boolean;
  acceptingOrders?: boolean;
  enable_order_book?: boolean;
  enableOrderBook?: boolean;
  market?: string;
  game_start_time?: string | number;
  gameStartTime?: string | number;
  startDate?: string | number;
  start_date?: string | number;
  clob_token_ids?: unknown;
  clobTokenIds?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  outcome_prices?: unknown;
  umaResolutionStatus?: string;
  uma_resolution_status?: string;
  group_item_title?: string;
  groupItemTitle?: string;
  sports_market_type?: string;
  sportsMarketType?: string;
  tags?: unknown;
  events?: unknown;
  tokens?: Array<{ token_id?: string; outcome?: string; price?: number; winner?: boolean }>;
}

export interface PolymarketRawEvent {
  id?: string | number;
  title?: string;
  slug?: string;
  ticker?: string;
  seriesSlug?: string;
  startTime?: string | number;
  startDate?: string | number;
  tags?: unknown;
  markets?: PolymarketRawMarket[];
  /** Pandascore match ID，与 Sports WS `gameId` 对应 */
  gameId?: string | number;
}

export interface PolymarketBook {
  asset_id?: string;
  bids?: PolymarketPriceLevel[];
  asks?: PolymarketPriceLevel[];
  timestamp?: string | number;
}

export interface PolymarketPriceLevel {
  price?: string | number;
  size?: string | number;
}

/**
 * Index / 运行时 DTO 形状（非 Gamma 列表扫盘产物）。
 * `marketIndex.indexEntryToMappedMarket` 从此构造。
 */
export interface PolymarketMappedMarket {
  match: CollectMatchDto;
  bet: CollectBetDto;
  assetIds: [string, string];
  marketId: string;
  /** 对应 Sports WS 的 gameId（pandascore match ID） */
  gameId?: number;
}

const WINNER_RE = /winner|win|胜者|获胜|moneyline/i;

export function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function tagsText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((tag) => {
    if (typeof tag === "string") return tag;
    if (tag && typeof tag === "object") {
      const raw = tag as Record<string, unknown>;
      return String(raw.label ?? raw.name ?? raw.slug ?? "");
    }
    return "";
  }).join(" ").toLowerCase();
}

function eventText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((event) => {
    if (!event || typeof event !== "object") return "";
    const raw = event as Record<string, unknown>;
    const metadata = raw.eventMetadata && typeof raw.eventMetadata === "object"
      ? raw.eventMetadata as Record<string, unknown>
      : {};
    const series = Array.isArray(raw.series) ? raw.series : [];
    const seriesText = series.map((item) => {
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      return [row.title, row.slug, row.ticker].filter(Boolean).join(" ");
    }).join(" ");
    return [
      raw.title,
      raw.slug,
      raw.ticker,
      raw.seriesSlug,
      metadata.league,
      metadata.tournament,
      seriesText,
    ].filter(Boolean).join(" ");
  }).join(" ").toLowerCase();
}

/** 订单展示 / 单盘上下文；discovery 游戏码权威在 collector */
export function mapPolymarketGameId(market: PolymarketRawMarket): string | null {
  const text = [
    tagsText(market.tags),
    eventText(market.events),
    market.sports_market_type,
    market.sportsMarketType,
    market.question,
    market.title,
    market.slug,
    market.group_item_title,
    market.groupItemTitle,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/\bleague[-\s]+of[-\s]+legends\b|\blol\b/.test(text)) return "lol";
  if (/\bdota[-\s]*2?\b/.test(text)) return "dota2";
  if (/\bcs2\b|\bcsgo\b|counter[-\s]?strike/.test(text)) return "cs2";
  if (/\bhonor[-\s]+of[-\s]+kings\b|\bking[-\s]+of[-\s]+glory\b|\bkings[-\s]+of[-\s]+glory\b|\bhok\b|\bkog\b|王者荣耀/.test(text)) return "kog";
  if (/\bvalorant\b/.test(text)) return "valorant";
  return null;
}

function mapNumberOf(market: PolymarketRawMarket): number | null {
  const type = String(market.sports_market_type ?? market.sportsMarketType ?? "").toLowerCase();
  const groupTitle = String(market.group_item_title ?? market.groupItemTitle ?? "").trim().toLowerCase();
  if (groupTitle === "match winner")
    return 0;
  const groupMap = /^(?:map|game)\s*(\d+)\s+winner$/.exec(groupTitle);
  if (groupMap)
    return Number(groupMap[1]);

  const text = [
    type,
    market.question,
    market.title,
  ].filter(Boolean).join(" ");
  if (type === "moneyline" && WINNER_RE.test(text))
    return 0;
  if (type === "child_moneyline") {
    const questionMap = /\b(?:map|game)\s*(\d+)\s+winner\b/i.exec(text);
    if (questionMap)
      return Number(questionMap[1]);
  }
  return null;
}

/** 订单展示用文案（含已关闭 market，不做 open 过滤） */
export function polymarketOrderContextFromMarket(market: PolymarketRawMarket): {
  game: string;
  match: string;
  bet: string;
} {
  const map = mapNumberOf(market);
  const game = mapPolymarketGameId(market) ?? "";
  const match = String(market.question ?? market.title ?? market.slug ?? "").trim();
  let bet = "";
  if (map === 0)
    bet = "全场";
  else if (map !== null && map > 0)
    bet = `地图${map}`;
  return { game, match, bet };
}

export function decimalOddsFromProbability(price: string | number | undefined): number {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return 0;
  return truncateOddsTo3(1 / value);
}

export function bestAskFromBook(book: PolymarketBook | undefined): number {
  const asks = book?.asks ?? [];
  let best = Number.POSITIVE_INFINITY;
  for (const level of asks) {
    const price = Number(level.price);
    const size = Number(level.size);
    if (Number.isFinite(price) && price > 0 && price < best && (!Number.isFinite(size) || size > 0)) {
      best = price;
    }
  }
  return Number.isFinite(best) ? best : 0;
}

/** 最高买价 = 市价卖出可成交侧 */
export function bestBidFromBook(book: PolymarketBook | undefined): number {
  const bids = book?.bids ?? [];
  let best = 0;
  for (const level of bids) {
    const price = Number(level.price);
    const size = Number(level.size);
    if (Number.isFinite(price) && price > 0 && price > best && (!Number.isFinite(size) || size > 0)) {
      best = price;
    }
  }
  return best;
}

export interface PolymarketBidLevel {
  price: number;
  size: number;
}

/** 按 bid 深度估算卖出回款（USDC）；无流动性返回 0 */
export function estimatePolymarketSellProceedsUsdc(
  bids: PolymarketBidLevel[],
  shares: number,
): number {
  if (!Number.isFinite(shares) || shares <= 0 || !bids.length)
    return 0;
  let remaining = shares;
  let proceeds = 0;
  for (const level of bids) {
    if (remaining <= 0)
      break;
    const fill = Math.min(remaining, level.size);
    proceeds += fill * level.price;
    remaining -= fill;
  }
  if (remaining > 1e-6)
    return 0;
  return Math.round(proceeds * 10000) / 10000;
}

/** 浮动盈亏（USDC）= 按 bid 深度估算回款 − 成本 */
export function polymarketUnrealizedProfitUsdc(
  bids: PolymarketBidLevel[],
  shares: number,
  stakeUsdc: number,
): number {
  const proceeds = estimatePolymarketSellProceedsUsdc(bids, shares);
  if (proceeds <= 0)
    return 0;
  return Math.round((proceeds - stakeUsdc) * 10000) / 10000;
}
