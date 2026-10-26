// [changmen 扩展] 原有赛况预检；比分解析共用体育兼容规则，其余经典预检行为保留。
import type { BetOption } from "@changmen/client-core/models/betOption";
import { getPmSportScoreKind } from "@changmen/shared/pm_sport_score";
import { POLYMARKET_CLOB_API, POLYMARKET_GAMMA_API } from "../../../api";
import { parsePeriodHead, type PmSportLike } from "../../../markets/pmSportGuard";
import { parseEsportsScore } from "../../../markets/parseEsportsScore";
import { type PolymarketRawMarket } from "../../../markets/parse";
import { polymarketPluginGet } from "../../../transport/transport";

/** pm_sport 超过该时长则下单前拉 Gamma 兜底 */
export const PM_SPORT_STALE_MS = 45_000;

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
  if (!event || typeof event !== "object")
    return null;

  const parsed = parseEsportsScore(event.score);
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

export function isPmSportSnapshotStale(
  updatedAt: number | undefined,
  now = Date.now(),
): boolean {
  const ts = Number(updatedAt) || 0;
  if (!ts)
    return true;
  return now - ts > PM_SPORT_STALE_MS;
}

/** 已开赛或临近开赛时需要新鲜赛况 */
export function shouldRefreshPmSportForBet(option: BetOption, now = Date.now()): boolean {
  const pm = option.match?.pmSport;
  if (!pm)
    return true;
  if (!isPmSportSnapshotStale(pm.updatedAt, now))
    return false;

  const startAt = Number(option.match?.startAt) || 0;
  if (startAt > 0 && startAt <= now + 5 * 60_000)
    return true;
  if (pm.live === true || pm.ended === true)
    return true;
  return false;
}

export async function fetchGammaMarketByTokenId(tokenId: string): Promise<PolymarketRawMarket | null> {
  const id = String(tokenId ?? "").trim();
  if (!id)
    return null;
  const params = new URLSearchParams({ clob_token_ids: id });
  const data = await polymarketPluginGet<unknown>(
    `${POLYMARKET_GAMMA_API}/markets?${params.toString()}`,
  );
  const rows = unwrapArray<PolymarketRawMarket>(data);
  return rows[0] ?? null;
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

export async function fetchGammaEventById(eventId: string): Promise<GammaEventLike | null> {
  const id = String(eventId ?? "").trim();
  if (!id)
    return null;
  const data = await polymarketPluginGet<GammaEventLike>(
    `${POLYMARKET_GAMMA_API}/events/${encodeURIComponent(id)}`,
  );
  return data && typeof data === "object" ? data : null;
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
