import { expect, it } from "vitest";
it("packages/venue-adapter/contract/index.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/contract/index"), import("@changmen/client-core/contract")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/auth/credentials.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/auth/credentials"), import("@changmen/venue-browser/polymarket/auth/credentials")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/auth/l2Auth.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/auth/l2Auth"), import("@changmen/venue-browser/polymarket/auth/l2Auth")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/auth/profile.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/auth/profile"), import("@changmen/venue-browser/polymarket/auth/profile")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/diagnostics/orderTrace.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/diagnostics/orderTrace"), import("@changmen/venue-browser/polymarket/diagnostics/orderTrace")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/diagnostics/wsQuantityEvidence.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/diagnostics/wsQuantityEvidence"), import("@changmen/venue-browser/polymarket/diagnostics/wsQuantityEvidence")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/fok/bet.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/fok/bet"), import("@changmen/venue-browser/polymarket/fok/bet")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/fok/orderSettlement.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orderSettlement"), import("@changmen/venue-browser/polymarket/fok/orderSettlement")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/fok/preflight.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/fok/preflight"), import("@changmen/venue-browser/polymarket/fok/preflight")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/fok/settlementJob.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/settlementJob"), import("@changmen/venue-browser/polymarket/fok/settlementJob")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/gtc/contract.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/gtc/contract"), import("@changmen/venue-browser/polymarket/gtc/contract")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/gtc/fee.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/gtc/fee"), import("@changmen/venue-browser/polymarket/gtc/fee")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/gtc/index.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/gtc/index"), import("@changmen/venue-browser/polymarket/gtc/index")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/gtc/preparation.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/gtc/preparation"), import("@changmen/venue-browser/polymarket/gtc/preparation")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/gtc/sellCash.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/gtc/sellCash"), import("@changmen/venue-browser/polymarket/gtc/sellCash")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/orderBetLabel.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/orderBetLabel"), import("@changmen/venue-browser/polymarket/markets/orderBetLabel")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/parse.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/parse"), import("@changmen/venue-browser/polymarket/markets/parse")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/parseEsportsScore.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/parseEsportsScore"), import("@changmen/venue-browser/polymarket/markets/parseEsportsScore")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/pmGammaCache.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/pmGammaCache"), import("@changmen/venue-browser/polymarket/markets/pmGammaCache")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/pmMarketGuard.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/pmMarketGuard"), import("@changmen/venue-browser/polymarket/markets/pmMarketGuard")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/pmSportGamma.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/pmSportGamma"), import("@changmen/venue-browser/polymarket/markets/pmSportGamma")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/markets/pmSportGuard.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/markets/pmSportGuard"), import("@changmen/venue-browser/polymarket/markets/pmSportGuard")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/confirmation/legOutcome.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/confirmation/legOutcome"), import("@changmen/venue-browser/polymarket/orders/confirmation/legOutcome")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/confirmation/marketDelay.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/marketDelay"), import("@changmen/venue-browser/polymarket/orders/confirmation/marketDelay")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/confirmation/pmHeartbeat.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/confirmation/pmHeartbeat"), import("@changmen/venue-browser/polymarket/orders/confirmation/pmHeartbeat")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/facts/orderStatus.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/facts/orderStatus"), import("@changmen/venue-browser/polymarket/orders/facts/orderStatus")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/facts/orderTypes.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/facts/orderTypes"), import("@changmen/venue-browser/polymarket/orders/facts/orderTypes")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/facts/pmPostFillOrder.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/facts/pmPostFillOrder"), import("@changmen/venue-browser/polymarket/orders/facts/pmPostFillOrder")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/facts/pmTradeHashes.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/facts/pmTradeHashes"), import("@changmen/venue-browser/polymarket/orders/facts/pmTradeHashes")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/facts/tradeFailure.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/facts/tradeFailure"), import("@changmen/venue-browser/polymarket/orders/facts/tradeFailure")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/history/orders.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/history/orders"), import("@changmen/venue-browser/polymarket/orders/history/orders")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/history/pmActivity.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/history/pmActivity"), import("@changmen/venue-browser/polymarket/orders/history/pmActivity")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/history/pmActivityV2.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/history/pmActivityV2"), import("@changmen/venue-browser/polymarket/orders/history/pmActivityV2")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/history/pmOrderSync.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/history/pmOrderSync"), import("@changmen/venue-browser/polymarket/orders/history/pmOrderSync")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/history/pmStoredOrders.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/history/pmStoredOrders"), import("@changmen/venue-browser/polymarket/orders/history/pmStoredOrders")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/history/storedMarketRefresh.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/history/storedMarketRefresh"), import("@changmen/venue-browser/polymarket/orders/history/storedMarketRefresh")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/pmClientApi.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/pmClientApi"), import("@changmen/venue-browser/polymarket/orders/pmClientApi")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/pmFee.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/pmFee"), import("@changmen/venue-browser/polymarket/orders/pmFee")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/positions/pmLogicalPosition.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/positions/pmLogicalPosition"), import("@changmen/venue-browser/polymarket/orders/positions/pmLogicalPosition")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/orders/positions/pmOrigin.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/orders/positions/pmOrigin"), import("@changmen/venue-browser/polymarket/orders/positions/pmOrigin")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/quotes/pmTickBuffer.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/quotes/pmTickBuffer"), import("@changmen/venue-browser/polymarket/quotes/pmTickBuffer")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/quotes/pmTickMetadata.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/quotes/pmTickMetadata"), import("@changmen/venue-browser/polymarket/quotes/pmTickMetadata")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/quotes/pmTokenQuote.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/quotes/pmTokenQuote"), import("@changmen/venue-browser/polymarket/quotes/pmTokenQuote")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/realtime/fokCancellation.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/realtime/fokCancellation"), import("@changmen/venue-browser/polymarket/realtime/fokCancellation")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/realtime/userWs.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/realtime/userWs"), import("@changmen/venue-browser/polymarket/realtime/userWs")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/realtime/userWsMessages.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/realtime/userWsMessages"), import("@changmen/venue-browser/polymarket/realtime/userWsMessages")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/client/builder.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/client/builder"), import("@changmen/venue-browser/polymarket/submission/client/builder")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/client/pmBrowserSubmitClock.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/client/pmBrowserSubmitClock"), import("@changmen/venue-browser/polymarket/submission/client/pmBrowserSubmitClock")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/client/pmOrderClientCache.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/client/pmOrderClientCache"), import("@changmen/venue-browser/polymarket/submission/client/pmOrderClientCache")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/pmManualSell.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/pmManualSell"), import("@changmen/venue-browser/polymarket/submission/pmManualSell")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/legacy/pmBetGuard.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/legacy/pmBetGuard"), import("@changmen/venue-browser/polymarket/submission/preflight/legacy/pmBetGuard")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/legacy/pmSportGamma.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/legacy/pmSportGamma"), import("@changmen/venue-browser/polymarket/submission/preflight/legacy/pmSportGamma")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/optimized/pmBetGuard.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/optimized/pmBetGuard"), import("@changmen/venue-browser/polymarket/submission/preflight/optimized/pmBetGuard")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/optimized/pmExecutableQuote.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/optimized/pmExecutableQuote"), import("@changmen/venue-browser/polymarket/submission/preflight/optimized/pmExecutableQuote")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/optimized/pmFastPreflight.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/optimized/pmFastPreflight"), import("@changmen/venue-browser/polymarket/submission/preflight/optimized/pmFastPreflight")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/pmBetGuard.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/pmBetGuard"), import("@changmen/venue-browser/polymarket/submission/preflight/pmBetGuard")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/pmBuyPreflight.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/pmBuyPreflight"), import("@changmen/venue-browser/polymarket/submission/preflight/pmBuyPreflight")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/pmDetection.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/pmDetection"), import("@changmen/venue-browser/polymarket/submission/preflight/pmDetection")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/pmFokPreflightMode.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/pmFokPreflightMode"), import("@changmen/venue-browser/polymarket/submission/preflight/pmFokPreflightMode")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/preflight/pmStake.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/preflight/pmStake"), import("@changmen/venue-browser/polymarket/submission/preflight/pmStake")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/recovery/pmSubmitJournal.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/recovery/pmSubmitJournal"), import("@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/submission/recovery/pmUnknownSubmitRecovery.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/submission/recovery/pmUnknownSubmitRecovery"), import("@changmen/venue-browser/polymarket/submission/recovery/pmUnknownSubmitRecovery")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/transport/pmPublicRoute.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/transport/pmPublicRoute"), import("@changmen/venue-browser/polymarket/transport/pmPublicRoute")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/transport/pmTransport.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/transport/pmTransport"), import("@changmen/venue-browser/polymarket/transport/pmTransport")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/transport/transport.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/transport/transport"), import("@changmen/venue-browser/polymarket/transport/transport")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/wallet/contracts.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/wallet/contracts"), import("@changmen/venue-browser/polymarket/wallet/contracts")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/wallet/depositWallet.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/wallet/depositWallet"), import("@changmen/venue-browser/polymarket/wallet/depositWallet")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/wallet/polygonRpc.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/wallet/polygonRpc"), import("@changmen/venue-browser/polymarket/wallet/polygonRpc")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/polymarket/wallet/sessionBuilderConfig.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/polymarket/wallet/sessionBuilderConfig"), import("@changmen/venue-browser/polymarket/wallet/sessionBuilderConfig")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/shared/platforms.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/platforms"), import("@changmen/client-core/shared/platforms")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/shared/webBridge.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/webBridge"), import("@changmen/venue-browser/shared/webBridge")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
it("packages/venue-adapter/shared/webBridgeTypes.ts: retains every runtime export identity", async () => {
 const [old, canonical] = await Promise.all([import("@changmen/venue-browser/adapter/shared/webBridgeTypes"), import("@changmen/venue-browser/shared/webBridgeTypes")]);
 expect(Object.keys(old).sort()).toEqual(Object.keys(canonical).sort());
 for (const [name, value] of Object.entries(canonical)) expect((old as Record<string, unknown>)[name], name).toBe(value);
});
