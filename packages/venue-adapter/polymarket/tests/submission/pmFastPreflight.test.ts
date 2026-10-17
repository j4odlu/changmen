import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { runPmBuyPreflight } from "../../submission/preflight/pmBuyPreflight";
import { runPmBuyPreflight as before } from "./fixtures/pmBeforeFastPreflight";
import { prepareOptimizedFokExecution } from "../../submission/preflight/optimized/pmFastPreflight";
import { clearPmGammaCacheForTests } from "../../pmSportGamma";
import { registerWsBookShadowObserver } from "../../submission/preflight/optimized/wsBook/shadowObserver";

const io = vi.hoisted(() => ({ ready: true, generation: 1, quote: undefined as unknown, get: vi.fn(), prepare: vi.fn(), runtime: vi.fn() }));
vi.mock("../../transport", () => ({ polymarketPluginGet: io.get }));
vi.mock("../../pmClientApi", () => ({ pmPrepareSubmit: io.prepare, pmSubmitClockReady: () => io.ready }));
vi.mock("../../l2Auth", () => ({ parseTokenConfig: () => ({}), resolvePrivateKey: () => "private",
  resolveApiCreds: () => ({ address: "address", apiKey: "key", secret: "secret", passphrase: "phrase" }) }));
vi.mock("../../pmOrderClientCache", () => ({ getPolymarketOrderClientRuntime: io.runtime,
  polymarketSigningGeneration: () => io.generation }));
vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({ getVenueOddsEntry: () => io.quote }));
const account = { provider: "Polymarket", accountId: 1, token: "opaque", gateway: "https://clob.polymarket.com" } as PlatformAccount;
const option = () => ({ type: "Polymarket", itemId: "token", betId: "condition", bet: { round: 0 },
  match: { providers: { Polymarket: "event" }, pmSport: { live: true, updatedAt: Date.now() } } }) as BetOption;
const tasks = (market = vi.fn(async () => "same-book")) => ({ market, gateway: account.gateway,
  sportMode: "optimized" as const, requireClobConfirmation: true, runtimeBinding: () => "binding", missingCredentialsMessage: "missing" });
beforeEach(() => {
  vi.useFakeTimers(); clearPmGammaCacheForTests(); io.ready = true; io.generation = 1; io.quote = undefined;
  io.get.mockReset(); io.prepare.mockReset(); io.runtime.mockReset().mockReturnValue({ runtime: {}, cacheHit: true });
});
afterEach(() => vi.useRealTimers());
const delay = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

test("same inputs: slow status queries cost 1800ms before, but dynamic only waits 250ms for the book", async () => {
  io.get.mockImplementation((url: string) => url.includes("/events/") ? delay(1800, { live: true })
    : url.includes("/markets?") ? delay(1800, [{ active: true, events: [{ live: true }] }]) : delay(1200, { accepting_orders: true }));
  const at = Date.now(); const old = before(account, option(), tasks(vi.fn(() => delay(250, "same-book"))));
  await vi.advanceTimersByTimeAsync(1800);
  expect((await old).market).toEqual({ status: "fulfilled", value: "same-book" }); expect(Date.now() - at).toBe(1800);
  io.get.mockClear(); io.prepare.mockClear(); let completed = false;
  const next = runPmBuyPreflight(account, option(), tasks(vi.fn(() => delay(250, "same-book")))).then(value => { completed = true; return value; });
  await vi.advanceTimersByTimeAsync(249); expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(1); expect(completed).toBe(true);
  expect((await next).market).toEqual({ status: "fulfilled", value: "same-book" }); expect(io.get).not.toHaveBeenCalled();
  expect(io.prepare).not.toHaveBeenCalled();
});

test("cold clock prepares separately in 600ms; hot check never waits or starts that work", async () => {
  io.ready = false; const market = vi.fn(() => delay(250, "book"));
  await expect(runPmBuyPreflight(account, option(), tasks(market))).rejects.toThrow("提交准备未完成");
  expect(io.prepare).not.toHaveBeenCalled(); expect(market).not.toHaveBeenCalled();
  io.prepare.mockImplementation(async () => { await delay(600, null); io.ready = true; });
  const at = Date.now();
  const preparation = prepareOptimizedFokExecution(account);
  await vi.advanceTimersByTimeAsync(600); await preparation;
  const checked = runPmBuyPreflight(account, option(), tasks(market));
  await vi.advanceTimersByTimeAsync(250);
  expect((await checked).market.status).toBe("fulfilled"); expect(Date.now() - at).toBe(850);
  expect(io.prepare).toHaveBeenCalledOnce();
});

test("missing signer fails before requesting a book or starting clock preparation", async () => {
  io.runtime.mockImplementation(() => { throw new Error("signer not ready"); });
  const market = vi.fn(async () => "book");
  await expect(prepareOptimizedFokExecution(account)).rejects.toThrow("signer not ready");
  await expect(runPmBuyPreflight(account, option(), tasks(market))).rejects.toThrow("signer not ready");
  expect(market).not.toHaveBeenCalled(); expect(io.prepare).not.toHaveBeenCalled();
});

test("account revocation during advance preparation invalidates it", async () => {
  io.ready = false; io.prepare.mockImplementation(async () => { io.ready = true; io.generation++; });
  await expect(prepareOptimizedFokExecution(account)).rejects.toThrow("钱包或账号已改变");
});

test.each(["ended", "locked"])("known %s blocks locally without HTTP", async state => {
  const input = option(); if (state === "ended") input.match!.pmSport = { ended: true } as never;
  else io.quote = { isLock: true };
  const market = vi.fn(async () => "book");
  await expect(runPmBuyPreflight(account, input, tasks(market))).rejects.toThrow();
  expect(market).not.toHaveBeenCalled(); expect(io.get).not.toHaveBeenCalled();
});

test("precheck-only skips wallet and clock; book failures still reject", async () => {
  io.ready = false; io.runtime.mockImplementation(() => { throw new Error("must not read wallet"); });
  const opts = { ...tasks(), role: "precheckOnly" as const };
  expect((await runPmBuyPreflight(account, option(), opts)).runtime.value).toBeNull();
  await expect(runPmBuyPreflight(account, option(), { ...opts, market: async () => { throw new Error("trading is disabled"); } })).rejects.toThrow("trading is disabled");
  expect(io.runtime).not.toHaveBeenCalled(); expect(io.prepare).not.toHaveBeenCalled();
});

test("shadow success, failure and observer exceptions never substitute HTTP or add another market call", async () => {
  for (const throwing of [false, true]) {
    const finish = vi.fn(() => { if (throwing) throw new Error("diagnostics failed"); });
    const begin = vi.fn(() => finish), release = registerWsBookShadowObserver(begin);
    try {
      const value = Object.freeze({ price: .51, asks: Object.freeze([]) });
      const market = vi.fn(async () => value);
      expect((await runPmBuyPreflight(account, option(), tasks(market as never))).market.value).toBe(value);
      expect(market).toHaveBeenCalledOnce(); expect(begin).toHaveBeenCalledOnce(); expect(finish).toHaveBeenCalledWith(value, false);
      const error = new Error("HTTP failed"); const reject = vi.fn(async () => { throw error; });
      await expect(runPmBuyPreflight(account, option(), tasks(reject))).rejects.toBe(error);
      expect(reject).toHaveBeenCalledOnce(); expect(finish).toHaveBeenLastCalledWith(undefined, true);
    } finally { release(); }
  }
});

test.each(["legacy", undefined])("%s does not invoke a registered dynamic shadow observer", async mode => {
  const begin = vi.fn(), release = registerWsBookShadowObserver(begin);
  try {
    // No role/signing changes: precheck-only exercises the original orchestration branch.
    io.get.mockResolvedValue({ active: true, accepting_orders: true, events: [{ live: true }] });
    const market = vi.fn(async () => "http");
    await runPmBuyPreflight(account, option(), { ...tasks(market), sportMode: mode, role: "precheckOnly" });
    expect(begin).not.toHaveBeenCalled(); expect(market).toHaveBeenCalledOnce();
  } finally { release(); }
});
