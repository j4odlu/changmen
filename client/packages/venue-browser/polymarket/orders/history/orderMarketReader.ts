/** 官方市场数据读取：保留既有查询顺序、验证优先级及失败语义，不接触账号或订单金额。 */
import { polymarketMarketAssetIds, polymarketGammaMarketAssetIds, mergePolymarketClobMarket } from "@changmen/shared/pm_market_assets";
import { polymarketNeedsFinalResolution, polymarketWithFinalResolution } from "@changmen/shared/pm_settlement";
import type { PolymarketRawMarket } from "../../markets/parse";
import { POLYMARKET_CLOB_API, POLYMARKET_GAMMA_API, POLYMARKET_DATA_API } from "../../api";

export interface PolymarketOrderMarketReaderPorts {
  get: <T>(url: string) => Promise<T>;
  /** 按既有读取顺序发布已通过身份验证的市场元数据。 */
  publishMarket: (market: PolymarketRawMarket) => void;
}

export function createPolymarketOrderMarketReader({ get, publishMarket }: PolymarketOrderMarketReaderPorts) {
  function normalizeConditionId(id: string | undefined | null): string {
    return String(id ?? "").trim().toLowerCase();
  }

  function unwrapGammaMarkets(data: unknown): PolymarketRawMarket[] {
    if (Array.isArray(data))
      return data as PolymarketRawMarket[];
    const wrapped = data as { markets?: unknown; data?: unknown };
    if (Array.isArray(wrapped.markets))
      return wrapped.markets as PolymarketRawMarket[];
    if (Array.isArray(wrapped.data))
      return wrapped.data as PolymarketRawMarket[];
    return [];
  }

  function marketConditionId(market: PolymarketRawMarket): string {
    return normalizeConditionId(
      String(market.condition_id ?? market.conditionId ?? market.market ?? market.id ?? ""),
    );
  }

  async function fetchGammaMarketsChunk(params: URLSearchParams): Promise<PolymarketRawMarket[]> {
    try {
      const data = await get<unknown>(
        `${POLYMARKET_GAMMA_API}/markets/keyset?${params.toString()}`,
      );
      return unwrapGammaMarkets(data);
    }
    catch (err) {
      console.warn("[Polymarket] Gamma keyset lookup failed, fallback /markets", err);
      const data = await get<unknown>(
        `${POLYMARKET_GAMMA_API}/markets?${params.toString()}`,
      );
      return unwrapGammaMarkets(data);
    }
  }

  function rememberGammaMarket(out: Map<string, PolymarketRawMarket>, market: PolymarketRawMarket): void {
    if (!polymarketGammaMarketAssetIds(market).length) return;
    rememberSettlementMarket(out, market);
  }

  /** Gamma 入口已解码，或 CLOB 已通过 mergePolymarketClobMarket 校验的结算快照。 */
  function rememberSettlementMarket(out: Map<string, PolymarketRawMarket>, market: PolymarketRawMarket): void {
    if (!polymarketMarketAssetIds(market).length) return;
    publishMarket(market);
    const key = marketConditionId(market);
    if (key) out.set(key, market);
    for (const tokenId of polymarketMarketAssetIds(market)) {
      const tokenKey = normalizeConditionId(tokenId);
      if (tokenKey) out.set(`token:${tokenKey}`, market);
    }
  }

  async function fetchMarketsByConditionIds(
    ids: string[],
    tokenIds: string[] = [],
  ): Promise<Map<string, PolymarketRawMarket>> {
    const out = new Map<string, PolymarketRawMarket>();
    const unique = [...new Set(ids.map(id => normalizeConditionId(id)).filter(Boolean))];
    const uniqueTokens = [...new Set(tokenIds.map(id => String(id ?? "").trim()).filter(Boolean))];
    if (!unique.length && !uniqueTokens.length) return out;

    const chunkSize = 20;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const params = new URLSearchParams({ limit: String(chunk.length), closed: "any" });
      for (const id of chunk)
        params.append("condition_ids", id);
      try {
        for (const market of await fetchGammaMarketsChunk(params))
          rememberGammaMarket(out, market);
      }
      catch (fallbackErr) {
        console.warn("[Polymarket] Gamma market lookup failed", fallbackErr);
      }
    }

    for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
      const chunk = uniqueTokens.slice(i, i + chunkSize);
      const params = new URLSearchParams({ limit: String(chunk.length), closed: "any" });
      for (const id of chunk)
        params.append("clob_token_ids", id);
      try {
        for (const market of await fetchGammaMarketsChunk(params))
          rememberGammaMarket(out, market);
      }
      catch (fallbackErr) {
        console.warn("[Polymarket] Gamma token lookup failed", fallbackErr);
      }
    }

    const unresolvedPositions = uniqueTokens.filter(id => /^\d+$/.test(id) && !out.has(`token:${normalizeConditionId(id)}`));
    for (let i = 0; i < unresolvedPositions.length; i += chunkSize) {
      const chunk = unresolvedPositions.slice(i, i + chunkSize);
      const params = new URLSearchParams({ limit: String(chunk.length), closed: "any" });
      for (const id of chunk) params.append("position_ids", id);
      try { for (const market of await fetchGammaMarketsChunk(params)) rememberGammaMarket(out, market); }
      catch (error) { console.warn("[Polymarket] Gamma position lookup failed", error); }
    }

    // 每条 condition 都 overlay CLOB：持有买单结算以官方 tokens[].winner 为准
    for (const id of unique) {
      try {
        const clob = await get<PolymarketRawMarket>(
          `${POLYMARKET_CLOB_API}/markets/${encodeURIComponent(id)}`,
        );
        const merged = mergePolymarketClobMarket(clob, out.get(id), id);
        if (merged) rememberSettlementMarket(out, merged);
      }
      catch {
        // 单条 CLOB 失败：保留 Gamma（若有），仍可按有效价格提前判定。
      }
    }
    const pending = [...new Set(unique)].filter(id => polymarketNeedsFinalResolution(out.get(id)));
    for (let i = 0; i < pending.length; i += chunkSize) {
      const chunk = pending.slice(i, i + chunkSize);
      try {
        const response = await get<{ data?: unknown }>(`${POLYMARKET_DATA_API}/v2/resolutions?${new URLSearchParams({ condition: chunk.join(",") })}`);
        for (const id of chunk) {
          const market = out.get(id)!;
          const enriched = polymarketWithFinalResolution(market, response?.data);
          if (enriched !== market) rememberSettlementMarket(out, enriched);
        }
      }
      catch { /* Finality unavailable: preserve known order facts and retry on the next refresh. */ }
    }
    return out;
  }

  return { read: fetchMarketsByConditionIds };
}
