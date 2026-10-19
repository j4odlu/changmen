import { normalizeEpochMs } from "@changmen/shared/time/match_time";
import { directGet, directPostJson } from "@changmen/client-core/shared/http";

/** Mainnet REST — 见 https://docs.sx.bet/api-reference/introduction */
export const SXBET_API = "https://api.sx.bet";
/** Centrifugo realtime — 见 https://docs.sx.bet/developers/real-time */
export const SXBET_WS = "wss://realtime.sx.bet/connection/websocket";
export const SXBET_EXPLORER_API = "https://explorerl2.sx.technology/api";

export const SXBET_CHAIN_ID = 4162;
export const SXBET_ESPORTS_SPORT_ID = 9;
/** Market type 52 = moneyline (12) */
export const SXBET_MONEYLINE_TYPE = 52;
/** Mainnet USDC（6 decimals） */
export const SXBET_USDC = "0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B";
/** Deprecated order expiry field — always this value per docs */
export const SXBET_ORDER_EXPIRY = 2209006800;

const COLLECT_PAST_MS = 6 * 3600 * 1000;
const COLLECT_FUTURE_MS = 3600 * 1000;
const MAX_PAGES = 20;
const PAGE_SIZE = 100;
const ORDER_BATCH_SIZE = 20;
const BEST_ODDS_BATCH = 40;

export const SXBET_COLLECT_PAST_MS = COLLECT_PAST_MS;
export const SXBET_COLLECT_FUTURE_MS = COLLECT_FUTURE_MS;

export interface SxApiEnvelope<T> {
  status?: string;
  data?: T;
  errorCode?: string;
  message?: string;
}

export interface SxMarket {
  status?: string;
  marketHash?: string;
  outcomeOneName?: string;
  outcomeTwoName?: string;
  teamOneName?: string;
  teamTwoName?: string;
  type?: number;
  gameTime?: number;
  sportXeventId?: string;
  liveEnabled?: boolean;
  sportLabel?: string;
  sportId?: number;
  leagueId?: number;
  leagueLabel?: string;
  participantOneId?: number;
  participantTwoId?: number;
}

export interface SxOrder {
  marketHash?: string;
  percentageOdds?: string | number;
  isMakerBettingOutcomeOne?: boolean;
  orderStatus?: string;
  status?: string;
  orderHash?: string;
  totalBetSize?: string;
  fillAmount?: string;
  updateTime?: string | number;
}

export interface SxBestOddsSide {
  percentageOdds?: string | null;
  updatedAt?: number;
}

export interface SxBestOddsRow {
  marketHash?: string;
  baseToken?: string;
  outcomeOne?: SxBestOddsSide;
  outcomeTwo?: SxBestOddsSide;
}

/** WS `best_odds:global` 单条推送 */
export interface SxBestOddsWsUpdate {
  baseToken?: string;
  marketHash?: string;
  isMakerBettingOutcomeOne?: boolean;
  percentageOdds?: string | null;
  updatedAt?: number;
  sportId?: number;
  leagueId?: number;
}

export interface SxMetadata {
  executorAddress?: string;
  EIP712FillHasher?: string;
  TokenTransferProxy?: string;
  domainVersion?: string;
  chainVersion?: string;
  oddsLadderStepSize?: number;
  addresses?: Record<string, { USDC?: string; WSX?: string }>;
  takerMinimums?: Record<string, string>;
  makerOrderMinimums?: Record<string, string>;
}

export interface SxFillResult {
  fillHash?: string;
  isPartialFill?: boolean;
  totalFilled?: string;
  averageOdds?: string;
}

export interface SxTradeRow {
  fillHash?: string;
  tradeHash?: string;
  fillOrderHash?: string;
  orderHash?: string;
  bettor?: string;
  marketHash?: string;
  stake?: string;
  /** 人类可读 stake（USDC）— 官方示例与 stake 并存 */
  normalizedStake?: number | string;
  odds?: string;
  percentageOdds?: string;
  tradeStatus?: string;
  settled?: boolean;
  bettingOutcomeOne?: boolean;
  maker?: boolean;
  isMakerBettingOutcomeOne?: boolean;
  sportXeventId?: string;
  teamOneName?: string;
  teamTwoName?: string;
  leagueLabel?: string;
  gameTime?: number;
  createdAt?: string | number;
  updatedAt?: string | number;
  /**
   * 官方示例为人类可读 USDC 小数（如 `"2.035617"`），不是 wei。
   * @see https://docs.sx.bet/developers/fetching-trades
   */
  netReturn?: string | number;
  settleValue?: number | string;
  betTimeValue?: number | string;
}

let cachedMetadata: SxMetadata | null = null;
let cachedMetadataAt = 0;
const METADATA_TTL_MS = 10 * 60_000;

export function sxbetCollectStartTimeAllowed(startMs: number): boolean {
  const ms = normalizeEpochMs(startMs);
  if (!ms)
    return true;
  const now = Date.now();
  return ms >= now - COLLECT_PAST_MS && ms <= now + COLLECT_FUTURE_MS;
}

export async function fetchSxMetadata(force = false): Promise<SxMetadata> {
  if (!force && cachedMetadata && Date.now() - cachedMetadataAt < METADATA_TTL_MS)
    return cachedMetadata;
  const res = await directGet<SxApiEnvelope<SxMetadata>>(`${SXBET_API}/metadata`, {});
  const data = res?.data && typeof res.data === "object" ? res.data : {};
  cachedMetadata = data;
  cachedMetadataAt = Date.now();
  return data;
}

export function resolveSxUsdcAddress(meta?: SxMetadata | null): string {
  const fromMeta = meta?.addresses?.[String(SXBET_CHAIN_ID)]?.USDC;
  return String(fromMeta || SXBET_USDC).trim() || SXBET_USDC;
}

export async function fetchSxRealtimeToken(apiKey: string): Promise<string> {
  const key = String(apiKey || "").trim();
  if (!key)
    throw new Error("SXBet API key 为空");
  const res = await directGet<{ token?: string } | SxApiEnvelope<{ token?: string }>>(
    `${SXBET_API}/user/realtime-token/api-key`,
    { "x-api-key": key },
  );
  const token = (res as { token?: string })?.token
    ?? (res as SxApiEnvelope<{ token?: string }>)?.data?.token;
  if (!token)
    throw new Error("SXBet realtime token 为空");
  return String(token);
}

export async function fetchSxActiveEsportsMoneylineMarkets(): Promise<SxMarket[]> {
  const markets: SxMarket[] = [];
  let paginationKey: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      sportIds: String(SXBET_ESPORTS_SPORT_ID),
      type: String(SXBET_MONEYLINE_TYPE),
      pageSize: String(PAGE_SIZE),
    });
    if (paginationKey)
      params.set("paginationKey", paginationKey);

    const res = await directGet<SxApiEnvelope<{ markets?: SxMarket[]; nextKey?: string }>>(
      `${SXBET_API}/markets/active?${params.toString()}`,
      {},
    );
    const batch = Array.isArray(res?.data?.markets) ? res.data!.markets! : [];
    for (const row of batch) {
      if (String(row.status ?? "").toUpperCase() === "ACTIVE")
        markets.push(row);
    }
    paginationKey = res?.data?.nextKey;
    if (!paginationKey || !batch.length)
      break;
  }

  return markets;
}

export async function fetchSxOrdersForMarkets(hashes: string[]): Promise<Record<string, SxOrder[]>> {
  const unique = [...new Set(hashes.map(h => String(h || "").trim()).filter(Boolean))];
  const grouped: Record<string, SxOrder[]> = Object.fromEntries(unique.map(hash => [hash, []]));
  if (!unique.length)
    return grouped;

  for (let i = 0; i < unique.length; i += ORDER_BATCH_SIZE) {
    const chunk = unique.slice(i, i + ORDER_BATCH_SIZE);
    try {
      const res = await directGet<SxApiEnvelope<SxOrder[]>>(
        `${SXBET_API}/orders?marketHashes=${chunk.map(h => encodeURIComponent(h)).join(",")}`,
        {},
      );
      const rows = Array.isArray(res?.data) ? res.data : [];
      for (const order of rows) {
        const hash = String(order.marketHash ?? "");
        if (!hash)
          continue;
        if (!grouped[hash])
          grouped[hash] = [];
        grouped[hash].push(order);
      }
    }
    catch {
      // keep empty books for failed chunk
    }
  }

  return grouped;
}

/** 官方推荐：`GET /orders/odds/best` — maker 视角最优价 */
export async function fetchSxBestOdds(
  hashes: string[],
  baseToken = SXBET_USDC,
): Promise<Record<string, SxBestOddsRow>> {
  const unique = [...new Set(hashes.map(h => String(h || "").trim()).filter(Boolean))];
  const out: Record<string, SxBestOddsRow> = {};
  if (!unique.length)
    return out;

  for (let i = 0; i < unique.length; i += BEST_ODDS_BATCH) {
    const chunk = unique.slice(i, i + BEST_ODDS_BATCH);
    try {
      const params = new URLSearchParams({
        marketHashes: chunk.join(","),
        baseToken,
      });
      const res = await directGet<SxApiEnvelope<{ bestOdds?: SxBestOddsRow[] }>>(
        `${SXBET_API}/orders/odds/best?${params.toString()}`,
        {},
      );
      for (const row of res?.data?.bestOdds ?? []) {
        const hash = String(row.marketHash ?? "").trim();
        if (hash)
          out[hash] = row;
      }
    }
    catch {
      // leave missing markets empty
    }
  }
  return out;
}

export async function fetchSxUsdcBalance(address: string): Promise<number> {
  const wallet = String(address || "").trim();
  if (!wallet)
    return 0;
  const params = new URLSearchParams({
    module: "account",
    action: "tokenbalance",
    contractaddress: SXBET_USDC,
    address: wallet,
  });
  const res = await directGet<{ result?: string; status?: string }>(
    `${SXBET_EXPLORER_API}?${params.toString()}`,
    {},
  );
  const raw = Number(res?.result);
  if (!Number.isFinite(raw) || raw < 0)
    return 0;
  return raw / 1e6;
}

export async function fetchSxTrades(opts: {
  bettor: string;
  marketHashes?: string[];
  settled?: boolean;
  pageSize?: number;
}): Promise<SxTradeRow[]> {
  const bettor = String(opts.bettor || "").trim();
  if (!bettor)
    return [];
  const params = new URLSearchParams({
    bettor,
    pageSize: String(opts.pageSize ?? 50),
  });
  if (opts.marketHashes?.length)
    params.set("marketHashes", opts.marketHashes.slice(0, 100).join(","));
  if (opts.settled !== undefined)
    params.set("settled", String(opts.settled));
  const res = await directGet<SxApiEnvelope<SxTradeRow[] | { trades?: SxTradeRow[] }>>(
    `${SXBET_API}/trades?${params.toString()}`,
    {},
  );
  const data = res?.data;
  if (Array.isArray(data))
    return data;
  if (data && typeof data === "object" && Array.isArray((data as { trades?: SxTradeRow[] }).trades))
    return (data as { trades: SxTradeRow[] }).trades;
  return [];
}

export async function postSxFillOrder(body: Record<string, unknown>): Promise<SxApiEnvelope<SxFillResult>> {
  try {
    return await directPostJson<SxApiEnvelope<SxFillResult>>(
      `${SXBET_API}/orders/fill/v2`,
      {},
      body,
    );
  }
  catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    try {
      const parsed = JSON.parse(text) as SxApiEnvelope<SxFillResult>;
      if (parsed && typeof parsed === "object")
        return parsed;
    }
    catch {
      /* not json */
    }
    throw err;
  }
}
