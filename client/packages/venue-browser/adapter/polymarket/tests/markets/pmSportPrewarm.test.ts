import type { BetOption } from "@changmen/client-core/models/betOption";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const get = vi.hoisted(() => vi.fn());
vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: get }));
beforeEach(() => { vi.resetModules(); get.mockReset(); });
afterEach(() => vi.restoreAllMocks());
const option = (id = "a") => ({ type: "Polymarket", itemId: id, betId: id, bet: { round: 0 },
  match: { providers: { Polymarket: id }, startAt: Date.now() - 60_000 } }) as BetOption;
const drain = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

test("candidate prewarm shares Gamma with preflight but never prewarms CLOB", async () => {
  get.mockImplementation(async (url: string) => url.includes("/markets?") ? [{ active: true }] : { live: true, accepting_orders: true });
  const { prewarmPmSportForCandidate: warm } = await import("@changmen/venue-browser/polymarket/markets/pmSportPrewarm");
  const { resolvePolymarketBetBlockReason: check } = await import("@changmen/venue-browser/polymarket/submission/preflight/pmBetGuard");
  const input = option(); warm(input); warm(input); await drain();
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls.every(([url]) => String(url).includes("gamma-api"))).toBe(true);
  expect(await check(input, true)).toBeNull();
  expect(get).toHaveBeenCalledTimes(3);
});

test("at most two candidates run concurrently; excess candidates are not queued", async () => {
  const releases: Array<(value: unknown) => void> = [];
  get.mockImplementation(() => new Promise(resolve => releases.push(resolve)));
  const { prewarmPmSportForCandidate: warm } = await import("@changmen/venue-browser/polymarket/markets/pmSportPrewarm");
  for (const id of ["a", "b", "c", "d"]) warm(option(id));
  expect(get).toHaveBeenCalledTimes(4);
  releases.forEach(resolve => resolve(null)); await drain();
  expect(get).toHaveBeenCalledTimes(4);
});

test("rate limit survives failures and resets after two seconds", async () => {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  get.mockRejectedValue(new Error("offline"));
  const { prewarmPmSportForCandidate: warm } = await import("@changmen/venue-browser/polymarket/markets/pmSportPrewarm");
  for (const id of ["a", "b", "c", "d", "e"]) { warm(option(id)); await drain(); }
  expect(get).toHaveBeenCalledTimes(8);
  now += 2000; warm(option("e")); await drain();
  expect(get).toHaveBeenCalledTimes(10);
});

test("other venues and finished matches are never prewarmed", async () => {
  const { prewarmPmSportForCandidate: warm } = await import("@changmen/venue-browser/polymarket/markets/pmSportPrewarm");
  const nonPm = option(); nonPm.type = "RAY";
  const ended = option(); ended.match!.pmSport = { ended: true };
  warm(nonPm); warm(ended); expect(get).not.toHaveBeenCalled();
});
