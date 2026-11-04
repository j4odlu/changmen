import { polymarketGammaMarketAssetIds, polymarketMarketHasAssetMetadata } from "@changmen/shared/pm_market_assets";
import { POLYMARKET_GAMMA_API } from "../api";
import type { PolymarketRawMarket } from "./parse";

/** 明确身份冲突不能降级成普通的“未查到”，否则预检可能继续发送。 */
export class PmGammaAssetIdentityError extends Error {
  constructor() { super("Polymarket 市场交易资产或版本不一致"); }
}

export async function lookupGammaMarketAsset(id: string, get: (url: string) => Promise<unknown>): Promise<PolymarketRawMarket | null> {
  let incompatible = false;
  for (const field of /^\d+$/.test(id) ? ["clob_token_ids", "position_ids"] : ["clob_token_ids"]) {
    const params = new URLSearchParams({ [field]: id, closed: "any" });
    let data: unknown;
    try { data = await get(`${POLYMARKET_GAMMA_API}/markets?${params}`); }
    catch (error) {
      // 补查故障不能抹掉上一条响应已经给出的明确身份冲突。
      if (incompatible) throw new PmGammaAssetIdentityError();
      throw error;
    }
    for (const candidate of Array.isArray(data) ? data : []) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const market = candidate as PolymarketRawMarket;
      if (polymarketGammaMarketAssetIds(market).includes(id)) return market;
      if (polymarketMarketHasAssetMetadata(market) || market.conditionId || market.condition_id
        || [market.active, market.closed, market.archived, market.acceptingOrders].some(value => typeof value === "boolean")
        || Array.isArray(market.events)) incompatible = true;
    }
  }
  if (incompatible) throw new PmGammaAssetIdentityError();
  return null;
}
