import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { afterEach, describe, expect, it, vi } from "vitest";

// [changmen 扩展] 同时消费旧入口与新实现，检查导出身份及实际可变状态只有一份。
const entries = [
  ["credentials", () => import("@changmen/venue-browser/polymarket/auth/credentials"), () => import("@changmen/venue-browser/polymarket/auth/credentials")],
  ["l2Auth", () => import("@changmen/venue-browser/polymarket/auth/l2Auth"), () => import("@changmen/venue-browser/polymarket/auth/l2Auth")],
  ["profile", () => import("@changmen/venue-browser/polymarket/auth/profile"), () => import("@changmen/venue-browser/polymarket/auth/profile")],
  ["balance", () => import("@changmen/venue-browser/polymarket/wallet/balance"), () => import("@changmen/venue-browser/polymarket/wallet/balance")],
  ["contracts", () => import("@changmen/venue-browser/polymarket/wallet/contracts"), () => import("@changmen/venue-browser/polymarket/wallet/contracts")],
  ["depositWallet", () => import("@changmen/venue-browser/polymarket/wallet/depositWallet"), () => import("@changmen/venue-browser/polymarket/wallet/depositWallet")],
  ["polygonRpc", () => import("@changmen/venue-browser/polymarket/wallet/polygonRpc"), () => import("@changmen/venue-browser/polymarket/wallet/polygonRpc")],
  ["relayer", () => import("@changmen/venue-browser/polymarket/wallet/relayer"), () => import("@changmen/venue-browser/polymarket/wallet/relayer")],
  ["sessionBuilderConfig", () => import("@changmen/venue-browser/polymarket/wallet/sessionBuilderConfig"), () => import("@changmen/venue-browser/polymarket/wallet/sessionBuilderConfig")],
  ["walletPrepUnified", () => import("@changmen/venue-browser/polymarket/wallet/walletPrepUnified"), () => import("@changmen/venue-browser/polymarket/wallet/walletPrepUnified")],
  ["pmWalletPrepSdk", () => import("@changmen/venue-browser/polymarket/wallet/pmWalletPrepSdk"), () => import("@changmen/venue-browser/polymarket/wallet/pmWalletPrepSdk")],
  ["api", () => import("@changmen/venue-browser/polymarket/api"), () => import("@changmen/venue-browser/polymarket/api")],
  ["transport", () => import("@changmen/venue-browser/polymarket/transport/transport"), () => import("@changmen/venue-browser/polymarket/transport/transport")],
  ["pmTransport", () => import("@changmen/venue-browser/polymarket/transport/pmTransport"), () => import("@changmen/venue-browser/polymarket/transport/pmTransport")],
  ["pmTransportMode", () => import("@changmen/venue-browser/polymarket/pmTransportMode"), () => import("@changmen/venue-browser/polymarket/pmTransportMode")],
  ["pmAutoTransport", () => import("@changmen/venue-browser/polymarket/transport/pmAutoTransport"), () => import("@changmen/venue-browser/polymarket/transport/pmAutoTransport")],
  ["pmOfficialReachability", () => import("@changmen/venue-browser/polymarket/transport/pmOfficialReachability"), () => import("@changmen/venue-browser/polymarket/transport/pmOfficialReachability")],
  ["pmRoutingPreference", () => import("@changmen/venue-browser/polymarket/pmRoutingPreference"), () => import("@changmen/venue-browser/polymarket/pmRoutingPreference")],
  ["pmPublicRoute", () => import("@changmen/venue-browser/polymarket/transport/pmPublicRoute"), () => import("@changmen/venue-browser/polymarket/transport/pmPublicRoute")],
  ["collect", () => import("@changmen/venue-browser/polymarket/markets/collect"), () => import("@changmen/venue-browser/polymarket/markets/collect")],
  ["marketIndex", () => import("@changmen/venue-browser/polymarket/markets/marketIndex"), () => import("@changmen/venue-browser/polymarket/markets/marketIndex")],
  ["parse", () => import("@changmen/venue-browser/polymarket/markets/parse"), () => import("@changmen/venue-browser/polymarket/markets/parse")],
  ["parseEsportsScore", () => import("@changmen/venue-browser/polymarket/markets/parseEsportsScore"), () => import("@changmen/venue-browser/polymarket/markets/parseEsportsScore")],
  ["pmFootballDiscovery", () => import("@changmen/venue-browser/polymarket/markets/pmFootballDiscovery"), () => import("@changmen/venue-browser/polymarket/markets/pmFootballDiscovery")],
  ["pmSportGamma", () => import("@changmen/venue-browser/polymarket/markets/pmSportGamma"), () => import("@changmen/venue-browser/polymarket/markets/pmSportGamma")],
  ["pmSportGuard", () => import("@changmen/venue-browser/polymarket/markets/pmSportGuard"), () => import("@changmen/venue-browser/polymarket/markets/pmSportGuard")],
  ["pmMarketGuard", () => import("@changmen/venue-browser/polymarket/markets/pmMarketGuard"), () => import("@changmen/venue-browser/polymarket/markets/pmMarketGuard")],
  ["pmMapOutcomeStore", () => import("@changmen/venue-browser/polymarket/markets/pmMapOutcomeStore"), () => import("@changmen/venue-browser/polymarket/markets/pmMapOutcomeStore")],
  ["marketQuoteHub", () => import("@changmen/venue-browser/polymarket/marketQuoteHub"), () => import("@changmen/venue-browser/polymarket/marketQuoteHub")],
  ["sportQuoteHub", () => import("@changmen/venue-browser/polymarket/sportQuoteHub"), () => import("@changmen/venue-browser/polymarket/sportQuoteHub")],
  ["pmTokenQuote", () => import("@changmen/venue-browser/polymarket/quotes/pmTokenQuote"), () => import("@changmen/venue-browser/polymarket/quotes/pmTokenQuote")],
  ["priceQuote", () => import("@changmen/venue-browser/polymarket/priceQuote"), () => import("@changmen/venue-browser/polymarket/priceQuote")],
  ["pmTickBuffer", () => import("@changmen/venue-browser/polymarket/quotes/pmTickBuffer"), () => import("@changmen/venue-browser/polymarket/quotes/pmTickBuffer")],
  ["pmTickMetadata", () => import("@changmen/venue-browser/polymarket/quotes/pmTickMetadata"), () => import("@changmen/venue-browser/polymarket/quotes/pmTickMetadata")],
  ["pmTickPrice", () => import("@changmen/venue-browser/polymarket/pmTickPrice"), () => import("@changmen/venue-browser/polymarket/pmTickPrice")],
  ["pmTickState", () => import("@changmen/venue-browser/polymarket/pmTickState"), () => import("@changmen/venue-browser/polymarket/pmTickState")],
  ["pmArbPriceBufferMode", () => import("@changmen/venue-browser/polymarket/quotes/pmArbPriceBufferMode"), () => import("@changmen/venue-browser/polymarket/quotes/pmArbPriceBufferMode")],
  ["ws", () => import("@changmen/venue-browser/polymarket/ws"), () => import("@changmen/venue-browser/polymarket/ws")],
  ["wsConfig", () => import("@changmen/venue-browser/polymarket/wsConfig"), () => import("@changmen/venue-browser/polymarket/wsConfig")],
  ["wsQuotes", () => import("@changmen/venue-browser/polymarket/wsQuotes"), () => import("@changmen/venue-browser/polymarket/wsQuotes")],
  ["sportMarketWs", () => import("@changmen/venue-browser/polymarket/sportMarketWs"), () => import("@changmen/venue-browser/polymarket/sportMarketWs")],
  ["sportWsConfig", () => import("@changmen/venue-browser/polymarket/sportWsConfig"), () => import("@changmen/venue-browser/polymarket/sportWsConfig")],
  ["userWs", () => import("@changmen/venue-browser/polymarket/realtime/userWs"), () => import("@changmen/venue-browser/polymarket/realtime/userWs")],
  ["userWsMessages", () => import("@changmen/venue-browser/polymarket/realtime/userWsMessages"), () => import("@changmen/venue-browser/polymarket/realtime/userWsMessages")],
  ["pmMarketWsMode", () => import("@changmen/venue-browser/polymarket/pmMarketWsMode"), () => import("@changmen/venue-browser/polymarket/pmMarketWsMode")],
  ["pmUserWsMode", () => import("@changmen/venue-browser/polymarket/pmUserWsMode"), () => import("@changmen/venue-browser/polymarket/pmUserWsMode")],
  ["pmWsSourceMode", () => import("@changmen/venue-browser/polymarket/pmWsSourceMode"), () => import("@changmen/venue-browser/polymarket/pmWsSourceMode")],
  ["orders", () => import("@changmen/venue-browser/polymarket/orders/history/orders"), () => import("@changmen/venue-browser/polymarket/orders/history/orders")],
  ["orderStatus", () => import("@changmen/venue-browser/polymarket/orders/facts/orderStatus"), () => import("@changmen/venue-browser/polymarket/orders/facts/orderStatus")],
  ["orderTypes", () => import("@changmen/venue-browser/polymarket/orders/facts/orderTypes"), () => import("@changmen/venue-browser/polymarket/orders/facts/orderTypes")],
  ["legOutcome", () => import("@changmen/venue-browser/polymarket/orders/confirmation/legOutcome"), () => import("@changmen/venue-browser/polymarket/orders/confirmation/legOutcome")],
  ["marketDelay", () => import("@changmen/venue-browser/polymarket/orders/confirmation/marketDelay"), () => import("@changmen/venue-browser/polymarket/orders/confirmation/marketDelay")],
  ["pmActivity", () => import("@changmen/venue-browser/polymarket/orders/history/pmActivity"), () => import("@changmen/venue-browser/polymarket/orders/history/pmActivity")],
  ["pmActivityV2", () => import("@changmen/venue-browser/polymarket/orders/history/pmActivityV2"), () => import("@changmen/venue-browser/polymarket/orders/history/pmActivityV2")],
  ["pmClientApi", () => import("@changmen/venue-browser/polymarket/orders/pmClientApi"), () => import("@changmen/venue-browser/polymarket/orders/pmClientApi")],
  ["pmHeartbeat", () => import("@changmen/venue-browser/polymarket/orders/confirmation/pmHeartbeat"), () => import("@changmen/venue-browser/polymarket/orders/confirmation/pmHeartbeat")],
  ["pmLogicalPosition", () => import("@changmen/venue-browser/polymarket/orders/positions/pmLogicalPosition"), () => import("@changmen/venue-browser/polymarket/orders/positions/pmLogicalPosition")],
  ["pmOrigin", () => import("@changmen/venue-browser/polymarket/orders/positions/pmOrigin"), () => import("@changmen/venue-browser/polymarket/orders/positions/pmOrigin")],
  ["pmOrderSync", () => import("@changmen/venue-browser/polymarket/orders/history/pmOrderSync"), () => import("@changmen/venue-browser/polymarket/orders/history/pmOrderSync")],
  ["pmPostFillOrder", () => import("@changmen/venue-browser/polymarket/orders/facts/pmPostFillOrder"), () => import("@changmen/venue-browser/polymarket/orders/facts/pmPostFillOrder")],
  ["pmStoredOrders", () => import("@changmen/venue-browser/polymarket/orders/history/pmStoredOrders"), () => import("@changmen/venue-browser/polymarket/orders/history/pmStoredOrders")],
  ["pmTradeHashes", () => import("@changmen/venue-browser/polymarket/orders/facts/pmTradeHashes"), () => import("@changmen/venue-browser/polymarket/orders/facts/pmTradeHashes")],
  ["tradeFailure", () => import("@changmen/venue-browser/polymarket/orders/facts/tradeFailure"), () => import("@changmen/venue-browser/polymarket/orders/facts/tradeFailure")],
  ["pmFee", () => import("@changmen/venue-browser/polymarket/orders/pmFee"), () => import("@changmen/venue-browser/polymarket/orders/pmFee")],
  ["builder", () => import("@changmen/venue-browser/polymarket/submission/client/builder"), () => import("@changmen/venue-browser/polymarket/submission/client/builder")],
  ["pmBetGuard", () => import("@changmen/venue-browser/polymarket/submission/preflight/pmBetGuard"), () => import("@changmen/venue-browser/polymarket/submission/preflight/pmBetGuard")],
  ["pmBrowserSubmitClock", () => import("@changmen/venue-browser/polymarket/submission/client/pmBrowserSubmitClock"), () => import("@changmen/venue-browser/polymarket/submission/client/pmBrowserSubmitClock")],
  ["pmBuyOrderShares", () => import("@changmen/venue-browser/polymarket/pmBuyOrderShares"), () => import("@changmen/venue-browser/polymarket/pmBuyOrderShares")],
  ["pmDetection", () => import("@changmen/venue-browser/polymarket/submission/preflight/pmDetection"), () => import("@changmen/venue-browser/polymarket/submission/preflight/pmDetection")],
  ["pmManualSell", () => import("@changmen/venue-browser/polymarket/submission/pmManualSell"), () => import("@changmen/venue-browser/polymarket/submission/pmManualSell")],
  ["pmMarketOrderOptions", () => import("@changmen/venue-browser/polymarket/pmMarketOrderOptions"), () => import("@changmen/venue-browser/polymarket/pmMarketOrderOptions")],
  ["pmOrderClientCache", () => import("@changmen/venue-browser/polymarket/submission/client/pmOrderClientCache"), () => import("@changmen/venue-browser/polymarket/submission/client/pmOrderClientCache")],
  ["pmOrderSubmitMode", () => import("@changmen/venue-browser/polymarket/pmOrderSubmitMode"), () => import("@changmen/venue-browser/polymarket/pmOrderSubmitMode")],
  ["pmStake", () => import("@changmen/venue-browser/polymarket/submission/preflight/pmStake"), () => import("@changmen/venue-browser/polymarket/submission/preflight/pmStake")],
  ["pmSubmitJournal", () => import("@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal"), () => import("@changmen/venue-browser/polymarket/submission/recovery/pmSubmitJournal")],
  ["pmUnknownSubmitRecovery", () => import("@changmen/venue-browser/polymarket/submission/recovery/pmUnknownSubmitRecovery"), () => import("@changmen/venue-browser/polymarket/submission/recovery/pmUnknownSubmitRecovery")],
  ["orderTrace", () => import("@changmen/venue-browser/polymarket/diagnostics/orderTrace"), () => import("@changmen/venue-browser/polymarket/diagnostics/orderTrace")],
  ["pmExecutionMetrics", () => import("@changmen/venue-browser/polymarket/pmExecutionMetrics"), () => import("@changmen/venue-browser/polymarket/pmExecutionMetrics")],
  ["pmMarketClientMetrics", () => import("@changmen/venue-browser/polymarket/pmMarketClientMetrics"), () => import("@changmen/venue-browser/polymarket/pmMarketClientMetrics")],
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("pM functional relocation", () => {
  for (const [name, loadLegacy, loadMoved] of entries) {
    it(`${name}: old and moved entries share every runtime export`, async () => {
      const legacy = await loadLegacy();
      const moved = await loadMoved();
      expect(Object.keys(moved).sort()).toEqual(Object.keys(legacy).sort());
      for (const [key, value] of Object.entries(legacy))
        expect(Reflect.get(moved, key)).toBe(value);
    });
  }

  it("shares tick state and one listener across old and moved callers", async () => {
    const legacy = await import("@changmen/venue-browser/polymarket/pmTickState");
    const moved = await import("@changmen/venue-browser/polymarket/pmTickState");
    const listener = vi.fn();
    const stop = legacy.onPmTickChange(listener);
    try {
      moved.notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "migration-only", timestamp: 1000, new_tick_size: "0.01" }));
      expect(legacy.currentPmTick("migration-only")).toBe("0.01");
      expect(listener).toHaveBeenCalledTimes(1);
      stop();
      moved.notePmTickFrame(JSON.stringify({ event_type: "tick_size_change", asset_id: "migration-only", timestamp: 2000, new_tick_size: "0.001" }));
      expect(listener).toHaveBeenCalledTimes(1);
      legacy.clearPmTickStateForTests();
      expect(moved.currentPmTick("migration-only")).toBeUndefined();
    }
    finally { stop(); moved.clearPmTickStateForTests(); }
  });

  it("shares quote listeners without creating a WebSocket connection", async () => {
    const legacy = await import("@changmen/venue-browser/polymarket/marketQuoteHub");
    const moved = await import("@changmen/venue-browser/polymarket/marketQuoteHub");
    const listener = vi.fn();
    const stop = legacy.onPolymarketMarketQuote(listener);
    try {
      moved.__testPushPolymarketMarketQuote("migration-only", 0.5);
      expect(listener).toHaveBeenCalledTimes(1);
      stop();
      moved.__testPushPolymarketMarketQuote("migration-only", 0.6);
      expect(listener).toHaveBeenCalledTimes(1);
    }
    finally { stop(); moved.__testResetPolymarketMarketQuoteHub(); }
  });

  it("shares the stored-order loader registration across both entries", async () => {
    const legacy = await import("@changmen/venue-browser/polymarket/orders/history/pmStoredOrders");
    const moved = await import("@changmen/venue-browser/polymarket/orders/history/pmStoredOrders");
    const account = { accountId: 7001, provider: "Polymarket" } as PlatformAccount;
    const loader = vi.fn().mockResolvedValue([]);
    legacy.registerPolymarketStoredVenueOrdersLoader(loader);
    try {
      await moved.loadPolymarketStoredVenueOrders(account);
      expect(loader).toHaveBeenCalledExactlyOnceWith(account);
    }
    finally { moved.registerPolymarketStoredVenueOrdersLoader(async () => []); }
  });

  it("starts only one heartbeat session and timer through both entries", async () => {
    vi.useFakeTimers();
    const legacy = await import("@changmen/venue-browser/polymarket/orders/confirmation/pmHeartbeat");
    const moved = await import("@changmen/venue-browser/polymarket/orders/confirmation/pmHeartbeat");
    const api = await import("@changmen/venue-browser/polymarket/orders/pmClientApi");
    const post = vi.spyOn(api, "pmPostHeartbeat").mockResolvedValue({ heartbeat_id: "mock-only" });
    const account = { accountId: 7002, provider: "Polymarket" } as PlatformAccount;
    const before = vi.getTimerCount();
    try {
      legacy.ensurePolymarketHeartbeat(account);
      moved.ensurePolymarketHeartbeat(account);
      expect(post).toHaveBeenCalledTimes(1);
      expect(moved.getPolymarketHeartbeatAccountIdsForTests()).toEqual([7002]);
      expect(vi.getTimerCount()).toBe(before + 1);
      moved.stopPolymarketHeartbeat(7002);
      expect(legacy.getPolymarketHeartbeatAccountIdsForTests()).toEqual([]);
      expect(vi.getTimerCount()).toBe(before);
    }
    finally { moved.stopAllPolymarketHeartbeats(); }
  });
});
