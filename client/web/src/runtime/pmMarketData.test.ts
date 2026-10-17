import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { reactive } from "vue";
import { startPmMarketData, acquirePmDepthView } from "./pmMarketData";
const io = vi.hoisted(() => ({ accounts: {} as { accounts: Array<Record<string, unknown>> }, route: "direct",
  create: vi.fn(), start: vi.fn(), stop: vi.fn(), stopConsumer: vi.fn(), acquire: vi.fn() }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => io.accounts }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ getPmMarketWsSourceMode: () => "official", resolvePmHttpMode: () => io.route, resolvePmOrderSubmitHttpMode: () => io.route }));
vi.mock("@changmen/venue-adapter/polymarket/orderBook", () => ({ createPmOrderBookService: io.create }));
vi.mock("./pmDynamicWsShadowWorker", () => ({ startPmDynamicWsShadowWorker: io.start }));
let owner: ReturnType<typeof startPmMarketData> | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("window", {}); io.route = "direct";
  io.accounts = reactive({ accounts: [{ accountId: 1, provider: "Polymarket", token: "old" }] });
  io.create.mockReset().mockImplementation(() => ({ stop: io.stop, acquire: io.acquire, report: () => ({ worker: true }) }));
  io.start.mockReset().mockReturnValue(io.stopConsumer); io.stop.mockClear(); io.stopConsumer.mockClear(); io.acquire.mockClear();
  localStorage.removeItem("changmen:pm:ws-book-shadow");
});
afterEach(() => { owner?.stop(); owner = undefined; localStorage.removeItem("changmen:pm:ws-book-shadow"); vi.useRealTimers(); vi.unstubAllGlobals(); });
test("independent owner starts without dynamic consumer and preserves cache on consumer toggle/token rotation", () => {
  owner = startPmMarketData(() => true); expect(io.create).toHaveBeenCalledOnce(); expect(io.start).not.toHaveBeenCalled();
  acquirePmDepthView(); expect(io.acquire).toHaveBeenCalledOnce();
  localStorage.setItem("changmen:pm:ws-book-shadow", "1"); owner.reconcile(); expect(io.start).toHaveBeenCalledOnce();
  io.accounts.accounts[0]!.token = "new"; expect(io.create).toHaveBeenCalledOnce(); expect(io.stop).not.toHaveBeenCalled();
  localStorage.removeItem("changmen:pm:ws-book-shadow"); owner.reconcile(); expect(io.stopConsumer).toHaveBeenCalledOnce(); expect(io.stop).not.toHaveBeenCalled();
});
test("loss of authorization destroys service synchronously; no automatic restart of failed worker", () => {
  let enabled = true; owner = startPmMarketData(() => enabled); enabled = false; owner.reconcile();
  expect(io.stop).toHaveBeenCalledOnce(); expect(acquirePmDepthView()).toBeUndefined();
  enabled = true; io.create.mockReturnValue({ stop: io.stop, report: () => ({ worker: false }) }); owner.reconcile();
  localStorage.setItem("changmen:pm:ws-book-shadow", "1"); owner.reconcile(); owner.reconcile();
  expect(io.create).toHaveBeenCalledTimes(2); expect(io.start).not.toHaveBeenCalled();
});
test("non-direct account/route never creates service or consumer", () => {
  io.route = "vps"; owner = startPmMarketData(() => true); expect(io.create).not.toHaveBeenCalled();
  io.route = "direct"; io.accounts.accounts[0]!.proxyId = 3; owner.reconcile(); expect(io.create).not.toHaveBeenCalled();
});
