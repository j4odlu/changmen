export interface PolymarketAssetMarket {
  version?: unknown;
  clobTokenIds?: unknown;
  clob_token_ids?: unknown;
  positionIds?: unknown;
  position_ids?: unknown;
}
export function polymarketMarketAssetIds(market: PolymarketAssetMarket | null | undefined): string[];
export function polymarketMarketAssetFields(market: PolymarketAssetMarket | null | undefined, ids: string[]): {
  positionIds?: string[]; position_ids?: string[]; clobTokenIds?: string; clob_token_ids?: string;
};
