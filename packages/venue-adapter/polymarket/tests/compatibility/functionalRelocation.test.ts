import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { afterEach, describe, expect, it, vi } from "vitest";

// [changmen 扩展] 同时消费旧入口与新实现，检查导出身份及实际可变状态只有一份。
const entries = [
  ["credentials", () => import("../../credentials"), () => import("../../auth/credentials")],
  ["l2Auth", () => import("../../l2Auth"), () => import("../../auth/l2Auth")],
  ["profile", () => import("../../profile"), () => import("../../auth/profile")],
  ["balance", () => import("../../balance"), () => import("../../wallet/balance")],
  ["contracts", () => import("../../contracts"), () => import("../../wallet/contracts")],
  ["depositWallet", () => import("../../depositWallet"), () => import("../../wallet/depositWallet")],
  ["polygonRpc", () => import("../../polygonRpc"), () => import("../../wallet/polygonRpc")],
  ["relayer", () => import("../../relayer"), () => import("../../wallet/relayer")],
  ["sessionBuilderConfig", () => import("../../sessionBuilderConfig"), () => import("../../wallet/sessionBuilderConfig")],
  ["walletPrepUnified", () => import("../../walletPrepUnified"), () => import("../../wallet/walletPrepUnified")],
  ["pmWalletPrepSdk", () => import("../../pmWalletPrepSdk"), () => import("../../wallet/pmWalletPrepSdk")],
  ["api", () => import("../../api"), () => import("../../transport/api")],
  ["transport", () => import("../../transport"), () => import("../../transport/transport")],
  ["pmTransport", () => import("../../pmTransport"), () => import("../../transport/pmTransport")],
  ["pmTransportMode", () => import("../../pmTransportMode"), () => import("../../transport/pmTransportMode")],
  ["pmAutoTransport", () => import("../../pmAutoTransport"), () => import("../../transport/pmAutoTransport")],
  ["pmOfficialReachability", () => import("../../pmOfficialReachability"), () => import("../../transport/pmOfficialReachability")],
  ["pmRoutingPreference", () => import("../../pmRoutingPreference"), () => import("../../transport/pmRoutingPreference")],
  ["pmPublicRoute", () => import("../../pmPublicRoute"), () => import("../../transport/pmPublicRoute")],
  ["collect", () => import("../../collect"), () => import("../../markets/collect")],
  ["marketIndex", () => import("../../marketIndex"), () => import("../../markets/marketIndex")],
  ["parse", () => import("../../parse"), () => import("../../markets/parse")],
  ["parseEsportsScore", () => import("../../parseEsportsScore"), () => import("../../markets/parseEsportsScore")],
  ["pmFootballDiscovery", () => import("../../pmFootballDiscovery"), () => import("../../markets/pmFootballDiscovery")],
  ["pmSportGamma", () => import("../../pmSportGamma"), () => import("../../markets/pmSportGamma")],
  ["pmSportGuard", () => import("../../pmSportGuard"), () => import("../../markets/pmSportGuard")],
  ["pmMarketGuard", () => import("../../pmMarketGuard"), () => import("../../markets/pmMarketGuard")],
  ["pmMapOutcomeStore", () => import("../../pmMapOutcomeStore"), () => import("../../markets/pmMapOutcomeStore")],
  ["marketQuoteHub", () => import("../../marketQuoteHub"), () => import("../../quotes/marketQuoteHub")],
  ["sportQuoteHub", () => import("../../sportQuoteHub"), () => import("../../quotes/sportQuoteHub")],
  ["pmTokenQuote", () => import("../../pmTokenQuote"), () => import("../../quotes/pmTokenQuote")],
  ["priceQuote", () => import("../../priceQuote"), () => import("../../quotes/priceQuote")],
  ["pmTickBuffer", () => import("../../pmTickBuffer"), () => import("../../quotes/pmTickBuffer")],
  ["pmTickMetadata", () => import("../../pmTickMetadata"), () => import("../../quotes/pmTickMetadata")],
  ["pmTickPrice", () => import("../../pmTickPrice"), () => import("../../quotes/pmTickPrice")],
  ["pmTickState", () => import("../../pmTickState"), () => import("../../quotes/pmTickState")],
  ["pmArbPriceBufferMode", () => import("../../pmArbPriceBufferMode"), () => import("../../quotes/pmArbPriceBufferMode")],
  ["ws", () => import("../../ws"), () => import("../../realtime/ws")],
  ["wsConfig", () => import("../../wsConfig"), () => import("../../realtime/wsConfig")],
  ["wsQuotes", () => import("../../wsQuotes"), () => import("../../realtime/wsQuotes")],
  ["sportMarketWs", () => import("../../sportMarketWs"), () => import("../../realtime/sportMarketWs")],
  ["sportWsConfig", () => import("../../sportWsConfig"), () => import("../../realtime/sportWsConfig")],
  ["userWs", () => import("../../userWs"), () => import("../../realtime/userWs")],
  ["userWsMessages", () => import("../../userWsMessages"), () => import("../../realtime/userWsMessages")],
  ["pmMarketWsMode", () => import("../../pmMarketWsMode"), () => import("../../realtime/pmMarketWsMode")],
  ["pmUserWsMode", () => import("../../pmUserWsMode"), () => import("../../realtime/pmUserWsMode")],
  ["pmWsSourceMode", () => import("../../pmWsSourceMode"), () => import("../../realtime/pmWsSourceMode")],
  ["orders", () => import("../../orders"), () => import("../../orders/history/orders")],
  ["orderStatus", () => import("../../orderStatus"), () => import("../../orders/facts/orderStatus")],
  ["orderTypes", () => import("../../orderTypes"), () => import("../../orders/facts/orderTypes")],
  ["legOutcome", () => import("../../legOutcome"), () => import("../../orders/confirmation/legOutcome")],
  ["marketDelay", () => import("../../marketDelay"), () => import("../../orders/confirmation/marketDelay")],
  ["pmActivity", () => import("../../pmActivity"), () => import("../../orders/history/pmActivity")],
  ["pmActivityV2", () => import("../../pmActivityV2"), () => import("../../orders/history/pmActivityV2")],
  ["pmClientApi", () => import("../../pmClientApi"), () => import("../../orders/pmClientApi")],
  ["pmHeartbeat", () => import("../../pmHeartbeat"), () => import("../../orders/confirmation/pmHeartbeat")],
  ["pmLogicalPosition", () => import("../../pmLogicalPosition"), () => import("../../orders/positions/pmLogicalPosition")],
  ["pmOrigin", () => import("../../pmOrigin"), () => import("../../orders/positions/pmOrigin")],
  ["pmOrderSync", () => import("../../pmOrderSync"), () => import("../../orders/history/pmOrderSync")],
  ["pmPostFillOrder", () => import("../../pmPostFillOrder"), () => import("../../orders/facts/pmPostFillOrder")],
  ["pmStoredOrders", () => import("../../pmStoredOrders"), () => import("../../orders/history/pmStoredOrders")],
  ["pmTradeHashes", () => import("../../pmTradeHashes"), () => import("../../orders/facts/pmTradeHashes")],
  ["tradeFailure", () => import("../../tradeFailure"), () => import("../../orders/facts/tradeFailure")],
  ["pmFee", () => import("../../pmFee"), () => import("../../orders/pmFee")],
  ["builder", () => import("../../builder"), () => import("../../submission/client/builder")],
  ["pmBetGuard", () => import("../../pmBetGuard"), () => import("../../submission/preflight/pmBetGuard")],
  ["pmBrowserSubmitClock", () => import("../../pmBrowserSubmitClock"), () => import("../../submission/client/pmBrowserSubmitClock")],
  ["pmBuyOrderShares", () => import("../../pmBuyOrderShares"), () => import("../../submission/preflight/pmBuyOrderShares")],
  ["pmDetection", () => import("../../pmDetection"), () => import("../../submission/preflight/pmDetection")],
  ["pmManualSell", () => import("../../pmManualSell"), () => import("../../submission/pmManualSell")],
  ["pmMarketOrderOptions", () => import("../../pmMarketOrderOptions"), () => import("../../submission/preflight/pmMarketOrderOptions")],
  ["pmOrderClientCache", () => import("../../pmOrderClientCache"), () => import("../../submission/client/pmOrderClientCache")],
  ["pmOrderSubmitMode", () => import("../../pmOrderSubmitMode"), () => import("../../submission/client/pmOrderSubmitMode")],
  ["pmStake", () => import("../../pmStake"), () => import("../../submission/preflight/pmStake")],
  ["pmSubmitJournal", () => import("../../pmSubmitJournal"), () => import("../../submission/recovery/pmSubmitJournal")],
  ["pmUnknownSubmitRecovery", () => import("../../pmUnknownSubmitRecovery"), () => import("../../submission/recovery/pmUnknownSubmitRecovery")],
  ["orderTrace", () => import("../../orderTrace"), () => import("../../diagnostics/orderTrace")],
  ["pmExecutionMetrics", () => import("../../pmExecutionMetrics"), () => import("../../diagnostics/pmExecutionMetrics")],
  ["pmMarketClientMetrics", () => import("../../pmMarketClientMetrics"), () => import("../../diagnostics/pmMarketClientMetrics")],
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
    const legacy = await import("../../pmTickState");
    const moved = await import("../../quotes/pmTickState");
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
    const legacy = await import("../../marketQuoteHub");
    const moved = await import("../../quotes/marketQuoteHub");
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
    const legacy = await import("../../pmStoredOrders");
    const moved = await import("../../orders/history/pmStoredOrders");
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
    const legacy = await import("../../pmHeartbeat");
    const moved = await import("../../orders/confirmation/pmHeartbeat");
    const api = await import("../../pmClientApi");
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
