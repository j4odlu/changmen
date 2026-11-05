import type { PolymarketAssetMarket } from "./pm_market_assets.js";
export interface PolymarketOrderSettlement {
  conditionId: string;
  assetId: string;
  price: 0 | 0.5 | 1;
  source: "resolution" | "clob";
}
export interface PolymarketFinalResolution {
  condition_id?: string | null;
  status?: string;
  payouts?: number[] | null;
  resolved_at?: string | null;
  transaction_hash?: string;
}
export interface PolymarketSettlementMarket extends PolymarketAssetMarket {
  closed?: boolean;
  umaResolutionStatus?: string;
  uma_resolution_status?: string;
  fallbackResolutionType?: string;
  finalResolution?: PolymarketFinalResolution;
}
export function polymarketEqualSplitResolved(market: PolymarketSettlementMarket | null | undefined): boolean;
export function polymarketFinalPayout(market: PolymarketSettlementMarket | null | undefined, assetId: string): PolymarketOrderSettlement | undefined;
export function polymarketVerifiedOrderPayout(order: { pmSettlement?: PolymarketOrderSettlement; pmConditionId?: string; pmTokenId?: string; pmMatchResult?: string } | null | undefined): 0 | 0.5 | 1 | undefined;
export function polymarketNeedsFinalResolution(market: PolymarketSettlementMarket | null | undefined): boolean;
export function polymarketWithFinalResolution<T extends PolymarketSettlementMarket>(market: T, rows: unknown): T;
export function polymarketIsEqualSplitOrder(order: { pmMatchResult?: unknown; PmMatchResult?: unknown } | null | undefined): boolean;
export function polymarketProfitStatus(money: number): "win" | "lose" | "return";
export function polymarketEqualSplitAmounts(remainingShares: number, remainingCost: number, realizedPnl?: number): {reward:number;money:number;status:"win"|"lose"|"return"} | null;
