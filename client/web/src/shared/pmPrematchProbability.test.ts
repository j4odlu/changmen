import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { gamma, get } = vi.hoisted(() => ({ gamma: vi.fn(), get: vi.fn() }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({
  fetchGammaMarketByTokenId: gamma,
  parseJsonArray: (v: string | undefined) => v ? JSON.parse(v) : [],
  POLYMARKET_DATA_API: "https://data-api.polymarket.com",
}));
vi.mock("@changmen/venue-adapter/polymarket/transport", () => ({ polymarketPluginGet: get }));
import { loadPrematchProbability, readPrematchPoint } from "./pmPrematchProbability";

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

it("queries map tokens independently at PM registered start minus one second and deduplicates requests", async () => {
  gamma.mockResolvedValue({ sportsMarketType: "child_moneyline", clobTokenIds: '["away","home"]', gameStartTime: "2026-01-01T14:30:00Z" });
  const cutoff = Date.parse("2026-01-01T14:30:00Z") / 1000 - 1;
  get.mockImplementation(async (url: string) => ({ data: [{ timestamp: cutoff, price: url.includes("token_id=home") ? .435 : .565, resolution_seconds: 0 }] }));
  const [result, second] = await Promise.all([loadPrematchProbability("home", "away"), loadPrematchProbability("home", "away")]);
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.value.home).toBeCloseTo(43.5);
    expect(result.value.away).toBeCloseTo(56.5);
    expect(result.value.cutoff).toBe(cutoff * 1000);
  }
  expect(second).toBe(result);
  expect(gamma).toHaveBeenCalledTimes(1);
  expect(get.mock.calls.map(([url]) => new URL(url).searchParams.get("token_id"))).toEqual(["home", "away"]);
  expect(get.mock.calls.every(([url]) => new URL(url).searchParams.get("as_of") === String(cutoff))).toBe(true);
});

it("rejects later observations and invalid prices but preserves legitimate zero", () => {
  expect(readPrematchPoint([
    { timestamp: 101, price: .8, resolution_seconds: 0 },
    { timestamp: 100, price: "", resolution_seconds: 0 },
    { timestamp: 99, price: 1.1, resolution_seconds: 0 },
    { timestamp: 98, price: 0, resolution_seconds: 0 },
    { timestamp: 97, price: .4, resolution_seconds: 60 },
  ], 100)).toEqual({ timestamp: 98, price: 0, resolution_seconds: 0 });
});

it("does not substitute live prices or creation time when historical data is missing", async () => {
  gamma.mockResolvedValue({ sportsMarketType: "moneyline", clobTokenIds: '["missing-home","missing-away"]', gameStartTime: "2026-01-01T14:30:00Z", outcomePrices: '[".9",".1"]' });
  get.mockResolvedValue({ data: [] });
  expect(await loadPrematchProbability("missing-home", "missing-away")).toEqual({ status: "missing" });
  get.mockClear();
  gamma.mockResolvedValue({ sportsMarketType: "moneyline", clobTokenIds: '["no-time-home","no-time-away"]', startDate: "2026-01-01T14:30:00Z" });
  expect(await loadPrematchProbability("no-time-home", "no-time-away")).toEqual({ status: "missing" });
  expect(get).not.toHaveBeenCalled();
});

it("waits for registered start before querying historical price", async () => {
  gamma.mockResolvedValue({ sportsMarketType: "moneyline", clobTokenIds: '["future-home","future-away"]', gameStartTime: "2099-01-01T14:30:00Z" });
  expect(await loadPrematchProbability("future-home", "future-away")).toEqual({ status: "pending" });
  expect(get).not.toHaveBeenCalled();
});

it("rechecks registered start after a successful cache expires", async () => {
  let now = Date.parse("2026-01-01T15:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const market = { sportsMarketType: "moneyline", clobTokenIds: '["refresh-home","refresh-away"]', gameStartTime: "2026-01-01T14:30:00Z" };
  gamma.mockResolvedValue(market);
  get.mockImplementation(async (url: string) => ({ data: [{ timestamp: Number(new URL(url).searchParams.get("as_of")), price: .5, resolution_seconds: 0 }] }));
  expect((await loadPrematchProbability("refresh-home", "refresh-away")).status).toBe("ready");
  market.gameStartTime = "2026-01-01T16:00:00Z";
  now += 599_999;
  expect((await loadPrematchProbability("refresh-home", "refresh-away")).status).toBe("ready");
  expect(gamma).toHaveBeenCalledTimes(1);
  now++;
  expect(await loadPrematchProbability("refresh-home", "refresh-away")).toEqual({ status: "pending" });
  expect(gamma).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledTimes(2);
  now += 60_000;
  market.gameStartTime = "2026-01-01T14:45:00Z";
  const result = await loadPrematchProbability("refresh-home", "refresh-away");
  expect(result.status).toBe("ready");
  if (result.status === "ready")
    expect(result.value.cutoff).toBe(Date.parse(market.gameStartTime) - 1000);
  expect(gamma).toHaveBeenCalledTimes(3);
});

it("retries failed queries after one minute instead of caching failure forever", async () => {
  let now = Date.parse("2026-01-01T15:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => now);
  gamma.mockRejectedValueOnce(new Error("network unavailable"));
  await expect(loadPrematchProbability("retry-home", "retry-away")).rejects.toThrow("network unavailable");
  now += 59_999;
  await expect(loadPrematchProbability("retry-home", "retry-away")).rejects.toThrow("network unavailable");
  expect(gamma).toHaveBeenCalledTimes(1);
  gamma.mockResolvedValue({ sportsMarketType: "moneyline", clobTokenIds: '["retry-home","retry-away"]', gameStartTime: "2026-01-01T14:30:00Z" });
  get.mockResolvedValue({ data: [{ timestamp: now / 1000 - 3600, price: .5, resolution_seconds: 0 }] });
  now++;
  expect((await loadPrematchProbability("retry-home", "retry-away")).status).toBe("ready");
  expect(gamma).toHaveBeenCalledTimes(2);
});
