import type { PlatformAdapter } from "../contract";
import { predictFunProvider } from "./bet";
import { startPredictFunCollector } from "./collect";

export { startPredictFunCollector };
export * from "./api";
export * from "./auth";
export * from "./bet";
export * from "./collect";
export * from "./credentials";
export * from "./masterAccount";
export * from "./userSession";
export * from "./userBuy";
export * from "./marketIndex";
export * from "./pfDetection";
export * from "./pfArbPriceBufferMode";
export * from "./legOutcome";
export * from "./pfClientApi";
export * from "./pfTransportMode";
export * from "./pfMarketWsMode";
export * from "./pfWsSourceMode";
export * from "./pfOfficialReachability";
export * from "./pfAutoTransport";
export * from "./transport";
export * from "./wsConfig";
export * from "./marketQuoteHub";
export * from "./sportQuoteHub";
export * from "./ws";

export const predictFunAdapter: PlatformAdapter = {
  id: "PredictFun",
  collector: startPredictFunCollector,
  provider: predictFunProvider,
};
