export interface PolymarketAssetMarket {
  version?: unknown;
  clobTokenIds?: unknown;
  clob_token_ids?: unknown;
  positionIds?: unknown;
  position_ids?: unknown;
  tokens?: unknown;
  conditionId?: unknown;
  condition_id?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  outcome_prices?: unknown;
}
export function polymarketMarketHasAsset(market: PolymarketAssetMarket | null | undefined, assetId: string): boolean;
export function polymarketMarketHasAssetMetadata(market: PolymarketAssetMarket | null | undefined): boolean;
export function polymarketMarketAssetForOutcome(market: PolymarketAssetMarket | null | undefined, outcome: unknown): string;
export function polymarketConditionsAgree(...values: unknown[]): boolean;
export function polymarketClobMarketAssetIds(market: PolymarketAssetMarket | null | undefined, fallbackVersion?: unknown): string[];
export function polymarketOfficialWinner(market: PolymarketAssetMarket | null | undefined): { assetId: string | null; ambiguous: boolean };
export function mergePolymarketClobMarket<T extends PolymarketAssetMarket>(clob: PolymarketAssetMarket | null | undefined, base?: T | null, expectedConditionId?: string): T | null;
export function polymarketMarketAssetIds(market: PolymarketAssetMarket | null | undefined): string[];
export function polymarketGammaMarketAssetIds(market: PolymarketAssetMarket | null | undefined): string[];
export function polymarketMarketAssetFields(market: PolymarketAssetMarket | null | undefined, ids: string[]): {
  positionIds?: string[]; position_ids?: string[]; clobTokenIds?: string; clob_token_ids?: string;
};
