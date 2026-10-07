import type { PlatformAdapter } from "../contract";
import { polymarketProvider } from "./bet";
import { startPolymarketCollector } from "./collect";

export { startPolymarketCollector };
export * from "./api";
export * from "./balance";
export * from "./bet";
export * from "./orderStatus";
export * from "./orderSettlement";
export * from "./orders";
export * from "./settlementJob";
export * from "./legOutcome";
export * from "./orderTypes";
export * from "./collect";
export {
  PolymarketPriceAboveDetectionError,
  isPolymarketPriceAboveDetectionError,
  syncPolymarketFoOnPriceAboveDetection,
} from "./pmTokenQuote";
export * from "./parse";
export * from "./pmSportGuard";
export * from "./pmSportGamma";
export * from "./pmMarketGuard";
export * from "./pmBetGuard";
export * from "./pmDetection";
export * from "./pmArbPriceBufferMode";
export * from "./pmFokDepthBufferMode";
export * from "./pmStake";
export * from "./pmTickPrice";
export * from "./pmManualSell";
export { pmAccountSubmitAttempts, finishPmSubmitAttempt, pmSubmitScope, pmSubmitMaker } from "./pmSubmitJournal";
export * from "./pmHeartbeat";
export * from "./pmStoredOrders";
export * from "./pmOrderSync";
export * from "./pmPostFillOrder";
export * from "./pmFee";
export * from "./pmActivity";
export * from "./pmAutoTransport";
export * from "./pmOfficialReachability";
export * from "./ws";
export * from "./pmMarketWsMode";
export * from "./pmUserWsMode";
export * from "./pmLogicalPosition";
export * from "./pmMapOutcomeStore";
export * from "./pmTransportMode";
export * from "./pmOrderSubmitMode";
export * from "./pmExecutionMetrics";
export * from "./pmMarketClientMetrics";
export * from "./pmRoutingPreference";
export * from "./pmWalletPrepSdk";
export * from "./credentials";
export * from "./depositWallet";
export * from "./polygonRpc";
export * from "./relayer";
export * from "./userWs";
export * from "./marketQuoteHub";
export * from "./sportQuoteHub";
export * from "./pmFootballDiscovery";
export * from "./wsQuotes";
export { clearPolymarketOrderClientCache } from "./pmOrderClientCache";

export const polymarketAdapter: PlatformAdapter = {
  id: "Polymarket",
  collector: startPolymarketCollector,
  provider: polymarketProvider,
};
