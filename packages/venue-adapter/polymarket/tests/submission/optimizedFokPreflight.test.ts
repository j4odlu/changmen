import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BetOption } from "@changmen/client-core/models/betOption";
// Frozen previous guard retained for the before/after replay and Gamma cache regressions.
import { resolveOptimizedFokBlockReason as check } from "./fixtures/pmBeforeFastGuard";
import { resolvePolymarketBetBlockReason as legacy } from "@changmen/venue-browser/polymarket/submission/preflight/legacy/pmBetGuard";
import { resolvePolymarketBetBlockReason as gtc } from "@changmen/venue-browser/polymarket/submission/preflight/pmBetGuard";
import { clearPmGammaCacheForTests, fetchGammaEventById } from "@changmen/venue-browser/polymarket/markets/pmSportGamma";
import { getPmGammaEvidence } from "@changmen/venue-browser/polymarket/markets/pmGammaCache";
import { polymarketPluginGet } from "@changmen/venue-browser/polymarket/transport/transport";
import { prewarmPmSportForCandidate } from "@changmen/venue-browser/polymarket/markets/pmSportPrewarm";
import { clearPmExecutionMetrics, getPmExecutionMetrics } from "@changmen/venue-browser/polymarket/pmExecutionMetrics";
vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: vi.fn() }));
const get = vi.mocked(polymarketPluginGet);
const option = () => ({ type: "Polymarket", itemId: "token", betId: "condition", bet: { round: 0 },
  match: { providers: { Polymarket: "event" }, startAt: Date.now() - 60_000,
    pmSport: { live: true, updatedAt: Date.now() } } }) as BetOption;
let market: Record<string, unknown>;
let event: Record<string, unknown> | null;
let clob: Record<string, unknown> | null;
beforeEach(() => {
  clearPmGammaCacheForTests(); clearPmExecutionMetrics(); get.mockReset();
  market = { active: true, closed: false }; event = { live: true, ended: false }; clob = { accepting_orders: true };
  get.mockImplementation(async url => url.includes("/events/") ? event : url.includes("/markets?") ? [market] : clob);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test("low probability alone does not deny executable optimized FOK; legacy and GTC retain their filter", async () => {
  market = { ...market, clobTokenIds: '["token","other"]', outcomePrices: '["0.08","0.92"]' };
  expect(await check(option(), true)).toBeNull();
  expect(await legacy(option())).toContain("几乎不可能");
  expect(await gtc(option(), true)).toContain("几乎不可能");
  expect(getPmExecutionMetrics()).toContainEqual(expect.objectContaining({ preflightMode: "optimized", riskSignal: expect.any(String) }));
});
test.each([{ closed: true }, { accepting_orders: false }, { active: false }, { enable_order_book: false },
  { tokens: [{ token_id: "other", winner: true }] }])("hard trading denial remains enforced: %j", async fields => {
  clob = { ...clob, ...fields };
  expect(await check(option(), true)).not.toBeNull();
});
test("both Gamma sport sources are checked; nonterminal event cannot hide embedded terminal evidence", async () => {
  market.events = [{ ended: true }];
  expect(await check(option(), true)).toContain("比赛已结束");
});
test("failed sport requests are unknown for automatic FOK; manual and legacy semantics remain explicit", async () => {
  event = null;
  expect(await check(option(), true)).toContain("赛况查询失败");
  expect(await check(option(), false)).toBeNull();
  expect(await legacy(option())).toBeNull();
  expect(await gtc(option(), true)).toBeNull();
});
test("valid fresh embedded sport can cover an unavailable event endpoint", async () => {
  event = null; market.events = [{ live: true, ended: false }];
  expect(await check(option(), true)).toBeNull();
});
test.each([null, {}, { accepting_orders: "true" }])("automatic requires explicit CLOB confirmation: %j", async value => {
  clob = value;
  expect(await check(option(), true)).toContain("接单状态未知");
});
test("slow in-flight data does not gain a fresh lifetime when it arrives, but terminal data still blocks", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000);
  const tick = vi.spyOn(performance, "now").mockReturnValue(100);
  let release!: (value: unknown) => void;
  get.mockImplementation(async url => url.includes("/events/") ? new Promise(resolve => { release = resolve; })
    : url.includes("/markets?") ? [market] : clob);
  const warm = fetchGammaEventById("event");
  const pending = check(option(), true);
  tick.mockReturnValue(2600); vi.setSystemTime(1_800_000_002_500);
  release({ live: true });
  expect(await pending).toContain("证据已过期");
  const value = await warm;
  expect(getPmGammaEvidence(value)).toMatchObject({ source: "network", fresh: false, requestMs: 2500, ageMs: 2500 });
  const terminal = check(option(), true);
  tick.mockReturnValue(5100); vi.setSystemTime(1_800_000_005_000); release({ ended: true });
  expect(await terminal).toContain("比赛已结束");
});
test("prewarming is reused and CLOB still runs for every attempt", async () => {
  const input = option(); prewarmPmSportForCandidate(input);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(get).toHaveBeenCalledTimes(2);
  expect(await check(input, true)).toBeNull();
  expect(await check(option(), true)).toBeNull();
  expect(get).toHaveBeenCalledTimes(4);
  expect(getPmExecutionMetrics().filter(row => row.gammaSource === "cache")).toHaveLength(4);
});
