import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { reactive, nextTick } from "vue";
import type { PmOrderBookService } from "@changmen/pm-market-data-browser/service";
import { startPmDynamicWsShadowWorker } from "./pmDynamicWsShadowWorker";
const io = vi.hoisted(() => ({ ws: "official", http: "direct", submit: "direct", accounts: {} as { accounts: Array<Record<string, unknown>> },
  matches: {} as { matchs: unknown[] }, odds: vi.fn(), construct: vi.fn(), setAssets: vi.fn(), stop: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => io.accounts }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => io.matches }));
vi.mock("@/stores/oddsStore", () => ({ useOddsStore: () => ({ getPmQuoteEntry: io.odds }) }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ getPmMarketWsSourceMode: () => io.ws,
  resolvePmHttpMode: () => io.http, resolvePmOrderSubmitHttpMode: () => io.submit,
  getPolymarketPmSportBlockReason: () => null }));
vi.mock("@changmen/venue-browser/pm-book-diagnostics/bookRuntime", () => ({
  officialGateway: (gateway: string) => gateway === "https://clob.polymarket.com",
}));
vi.mock("@changmen/venue-browser/pm-book-diagnostics/shadowWorkerClient", () => ({
  WsBookShadowWorkerClient: class {
    constructor(allowed: () => boolean) { io.construct(allowed); }
    setAssets = io.setAssets; stop = io.stop; reconcile = io.reconcile; report = () => ({ activeSupported: false });
  },
}));
let cleanup: ReturnType<typeof startPmDynamicWsShadowWorker> | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("window", {});
  io.ws = "official"; io.http = io.submit = "direct";
  io.accounts = reactive({ accounts: [{ accountId: 1, provider: "Polymarket", gateway: "https://clob.polymarket.com", token: "private-test-only" }] });
  io.matches = reactive({ matchs: [{ bets: [{ items: [{ type: "Polymarket", homeId: "1", awayId: "2" }] }] }] });
  io.construct.mockClear(); io.setAssets.mockClear(); io.stop.mockClear(); io.odds.mockReset().mockReturnValue({ isLock: false });
  io.reconcile.mockReset().mockReturnValue(true);
});

test("stopped runtime from a route bounce is replaced even when candidate ids stay identical", async () => {
  cleanup = startPmDynamicWsShadowWorker(() => true, {} as PmOrderBookService);
  io.reconcile.mockReturnValueOnce(false);
  cleanup.reconcile();
  expect(io.construct).toHaveBeenCalledTimes(2); expect(io.stop).toHaveBeenCalledOnce();
  expect(io.setAssets).toHaveBeenLastCalledWith(["1", "2"]);
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
test.each(["vps-http", "extension", "vps-submit", "vps-ws", "custom-gateway", "proxy"])("%s does not install candidate watchers or construct a depth runtime", mode => {
  if (mode === "vps-http") io.http = "vps";
  if (mode === "extension") io.http = "extension";
  if (mode === "vps-submit") io.submit = "vps";
  if (mode === "vps-ws") io.ws = "changmen";
  if (mode === "custom-gateway") io.accounts.accounts[0]!.gateway = "https://other";
  if (mode === "proxy") io.accounts.accounts[0]!.proxyId = 9;
  cleanup = startPmDynamicWsShadowWorker(() => true, {} as PmOrderBookService);
  expect(io.construct).not.toHaveBeenCalled(); expect(io.odds).not.toHaveBeenCalled();
});
test("direct-only runtime stops on route change, rebinds on account changes, releases watchers and report", async () => {
  cleanup = startPmDynamicWsShadowWorker(() => true, {} as PmOrderBookService);
  expect(io.construct).toHaveBeenCalledOnce(); expect(io.setAssets).toHaveBeenCalledWith(["1", "2"]);
  io.http = "vps";
  expect(io.construct.mock.calls[0]![0]()).toBe(false); // callbacks check routes immediately, before the 1s poll
  cleanup.reconcile(); expect(io.stop).toHaveBeenCalledOnce();
  io.http = "direct"; cleanup.reconcile(); expect(io.construct).toHaveBeenCalledTimes(2);
  io.accounts.accounts[0]!.token = "rotated-test-only"; expect(io.stop).toHaveBeenCalledTimes(2);
  expect(io.construct).toHaveBeenCalledTimes(3); expect(window.pmWsBookShadowReport?.()).toEqual({ activeSupported: false });
  cleanup(); cleanup = undefined; io.matches.matchs = []; await nextTick();
  expect(io.stop).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0); expect(window.pmWsBookShadowReport).toBeUndefined();
});
