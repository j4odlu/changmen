import type { PlatformAdapter } from "@changmen/client-core/contract";
import { polymarketProvider } from "@changmen/venue-browser/polymarket/fok/bet";
import { startPolymarketCollector } from "@changmen/venue-browser/polymarket/markets/collect";

export { startPolymarketCollector };
export * from "@changmen/venue-browser/polymarket/api";
export * from "@changmen/venue-browser/polymarket/wallet/balance";
export * from "@changmen/venue-browser/polymarket/fok/bet";
export * from "@changmen/venue-browser/polymarket/orders/facts/orderStatus";
export * from "@changmen/venue-browser/polymarket/fok/orderSettlement";
export * from "@changmen/venue-browser/polymarket/orders/history/orders";
export * from "@changmen/venue-browser/polymarket/fok/settlementJob";
export * from "@changmen/venue-browser/polymarket/orders/confirmation/legOutcome";
export * from "@changmen/venue-browser/polymarket/orders/facts/orderTypes";
export * from "@changmen/venue-browser/polymarket/markets/collect";
export {
  PolymarketPriceAboveDetectionError,
  isPolymarketPriceAboveDetectionError,
  syncPolymarketFoOnPriceAboveDetection,
} from "@changmen/venue-browser/polymarket/quotes/pmTokenQuote";
export * from "@changmen/venue-browser/polymarket/markets/parse";
export * from "@changmen/venue-browser/polymarket/markets/pmSportGuard";
export * from "@changmen/venue-browser/polymarket/markets/pmSportGamma";
export { prewarmPmSportForCandidate } from "@changmen/venue-browser/polymarket/markets/pmSportPrewarm";
export { prepareOptimizedFokExecution } from "@changmen/venue-browser/polymarket/submission/preflight/optimized/pmFastPreflight";
export * from "@changmen/venue-browser/polymarket/markets/pmMarketGuard";
export * from "@changmen/venue-browser/polymarket/submission/preflight/pmBetGuard";
export * from "@changmen/venue-browser/polymarket/submission/preflight/pmDetection";
export * from "@changmen/venue-browser/polymarket/quotes/pmArbPriceBufferMode";
export * from "@changmen/venue-browser/polymarket/pmFokDepthBufferMode";
export * from "@changmen/venue-browser/polymarket/submission/preflight/pmStake";
export * from "@changmen/venue-browser/polymarket/pmTickPrice";
export * from "@changmen/venue-browser/polymarket/pmTickState";
export * from "@changmen/venue-browser/polymarket/submission/pmManualSell";
export { pmAccountSubmitAttempts, finishPmSubmitAttempt, pmSubmitScope, pmSubmitMaker } from "@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal";
export * from "@changmen/venue-browser/polymarket/orders/confirmation/pmHeartbeat";
export * from "@changmen/venue-browser/polymarket/orders/history/pmStoredOrders";
export * from "@changmen/venue-browser/polymarket/orders/history/pmOrderSync";
export * from "@changmen/venue-browser/polymarket/orders/facts/pmPostFillOrder";
export * from "@changmen/venue-browser/polymarket/orders/pmFee";
export * from "@changmen/venue-browser/polymarket/orders/history/pmActivity";
export * from "@changmen/venue-browser/polymarket/transport/pmAutoTransport";
export * from "@changmen/venue-browser/polymarket/transport/pmOfficialReachability";
export * from "@changmen/venue-browser/polymarket/ws";
export * from "@changmen/venue-browser/polymarket/pmMarketWsMode";
export * from "@changmen/venue-browser/polymarket/pmUserWsMode";
export * from "@changmen/venue-browser/polymarket/orders/positions/pmLogicalPosition";
export * from "@changmen/venue-browser/polymarket/markets/pmMapOutcomeStore";
export * from "@changmen/venue-browser/polymarket/pmTransportMode";
export * from "@changmen/venue-browser/polymarket/pmOrderSubmitMode";
export * from "@changmen/venue-browser/polymarket/pmExecutionMetrics";
export * from "@changmen/venue-browser/polymarket/pmMarketClientMetrics";
export * from "@changmen/venue-browser/polymarket/pmRoutingPreference";
export * from "@changmen/venue-browser/polymarket/wallet/pmWalletPrepSdk";
export * from "@changmen/venue-browser/polymarket/auth/credentials";
export * from "@changmen/venue-browser/polymarket/wallet/depositWallet";
export * from "@changmen/venue-browser/polymarket/wallet/polygonRpc";
export * from "@changmen/venue-browser/polymarket/wallet/relayer";
export * from "@changmen/venue-browser/polymarket/realtime/userWs";
export * from "@changmen/venue-browser/polymarket/marketQuoteHub";
export * from "@changmen/venue-browser/polymarket/sportQuoteHub";
export * from "@changmen/venue-browser/polymarket/markets/pmFootballDiscovery";
export * from "@changmen/venue-browser/polymarket/wsQuotes";
export { clearPolymarketOrderClientCache, preparePolymarketAccountRuntimes, retainPolymarketAccountRuntimes } from "@changmen/venue-browser/polymarket/submission/client/pmOrderClientCache";

export const polymarketAdapter: PlatformAdapter = {
  id: "Polymarket",
  collector: startPolymarketCollector,
  provider: polymarketProvider,
};

export { setPmFokPreflightMode, capturePmFokPreflightMode } from "@changmen/venue-browser/polymarket/submission/preflight/pmFokPreflightMode";
