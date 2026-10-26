import type { BetOption } from "@changmen/client-core/models/betOption";
import { getPmSportScoreKind } from "@changmen/shared/pm_sport_score";
import { POLYMARKET_CLOB_API, POLYMARKET_GAMMA_API } from "../api";
import { parsePeriodHead, type PmSportLike } from "./pmSportGuard";
import { parseEsportsScore } from "./parseEsportsScore";
import { parseJsonArray, type PolymarketRawMarket } from "./parse";
import { polymarketPluginGet } from "../transport/transport";
import { createPmGammaReader } from "./pmGammaCache";

export interface GammaEventLike {
  id?: string | number;
  slug?: string;
  title?: string;
  gameId?: string | number;
  score?: string;
  period?: string;
  live?: boolean;
  ended?: boolean;
  elapsed?: string | number;
  resolutionSource?: string;
}

function unwrapArray<T>(data: unknown): T[] {
  if (Array.isArray(data))
    return data as T[];
  return [];
}

export function gammaEventToPmSportLike(event: GammaEventLike | null | undefined): PmSportLike | null {
  if (!event || typeof event !== "object" || Array.isArray(event))
    return null;

  const parsed = parseEsportsScore(event.score);
  if (typeof event.live !== "boolean" && typeof event.ended !== "boolean"
    && !(typeof event.score === "string" && /^\d+\s*-\s*\d+(?:\||$)/.test(event.score.trim()))
    && !parsePeriodHead(event.period))
    return null;
  const live = event.live === true;
  const ended = event.ended === true;
  const status = ended
    ? "finished"
    : live
      ? "running"
      : "not_started";

  return {
    ended,
    live,
    status,
    bo: parsed.bo,
    period: event.period ? String(event.period) : undefined,
    currentMap: parsePeriodHead(event.period ? String(event.period) : undefined),
    mapScore: parsed.mapScore,
    scoreRaw: event.score,
    scoreKind: getPmSportScoreKind(event.score),
  };
}

const gammaMarkets = createPmGammaReader<PolymarketRawMarket>(async id => {
  const params = new URLSearchParams({ clob_token_ids: id });
  const data = await polymarketPluginGet<unknown>(
    `${POLYMARKET_GAMMA_API}/markets?${params.toString()}`,
  );
  const rows = unwrapArray<PolymarketRawMarket>(data);
  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  // [changmen 扩展] 错误/纯元数据不能占据短缓存，下一轮应立即重查交易状态。
  const hasStatus = [row.active, row.closed, row.archived, row.acceptingOrders, row.accepting_orders,
    row.enableOrderBook, row.enable_order_book].some(value => typeof value === "boolean");
  const hasPrices = parseJsonArray(row.clobTokenIds ?? row.clob_token_ids).length > 0
    && parseJsonArray(row.outcomePrices ?? row.outcome_prices).length > 0;
  const hasWinner = Array.isArray(row.tokens) && row.tokens.some(token => token?.winner === true && token.token_id);
  const hasSport = Array.isArray(row.events) && row.events.some(event => gammaEventToPmSportLike(event as GammaEventLike));
  return hasStatus || hasPrices || hasSport || hasWinner ? row : null;
});

export async function fetchGammaMarketByTokenId(tokenId: string): Promise<PolymarketRawMarket | null> {
  const id = String(tokenId ?? "").trim();
  return id ? gammaMarkets.read(id) : null;
}

/** CLOB 市场行：`accepting_orders` / closed 比 Gamma 更接近 POST /order 闸门 */
export async function fetchClobMarketByConditionId(conditionId: string): Promise<PolymarketRawMarket | null> {
  const id = String(conditionId ?? "").trim();
  if (!id)
    return null;
  try {
    const data = await polymarketPluginGet<PolymarketRawMarket>(
      `${POLYMARKET_CLOB_API}/markets/${encodeURIComponent(id)}`,
    );
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  }
  catch {
    return null;
  }
}

const gammaEvents = createPmGammaReader<GammaEventLike>(async id => {
  const data = await polymarketPluginGet<GammaEventLike>(
    `${POLYMARKET_GAMMA_API}/events/${encodeURIComponent(id)}`,
  );
  return gammaEventToPmSportLike(data) ? data : null;
});

export async function fetchGammaEventById(eventId: string): Promise<GammaEventLike | null> {
  const id = String(eventId ?? "").trim();
  return id ? gammaEvents.read(id) : null;
}

export function clearPmGammaCacheForTests(): void {
  gammaMarkets.clear();
  gammaEvents.clear();
}

export async function fetchPmSportLikeForOption(option: BetOption): Promise<PmSportLike | null> {
  const eventId = String(option.match?.providers?.Polymarket ?? "").trim();
  if (eventId) {
    const event = await fetchGammaEventById(eventId);
    const pm = gammaEventToPmSportLike(event);
    if (pm)
      return pm;
  }

  const market = await fetchGammaMarketByTokenId(option.itemId);
  if (market) {
    const events = Array.isArray(market.events) ? market.events : [];
    const embedded = events[0] as GammaEventLike | undefined;
    if (embedded)
      return gammaEventToPmSportLike(embedded);
  }

  return null;
}
