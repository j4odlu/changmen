import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearPmGammaCacheForTests, fetchGammaEventById, fetchGammaMarketByTokenId,
  fetchClobMarketByConditionId,
} from "@changmen/venue-browser/polymarket/markets/pmSportGamma";
import { PM_GAMMA_CACHE_MS } from "@changmen/venue-browser/polymarket/markets/pmGammaCache";
import { polymarketPluginGet } from "@changmen/venue-browser/polymarket/transport/transport";

vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet: vi.fn() }));
const now = 1_800_000_000_000;
beforeEach(() => {
  clearPmGammaCacheForTests();
  vi.mocked(polymarketPluginGet).mockReset();
  vi.useFakeTimers(); vi.setSystemTime(now);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Gamma short cache", () => {
  test.each(["market", "event"])("%s coalesces concurrent reads and expires from request start", async kind => {
    const read = kind === "market" ? fetchGammaMarketByTokenId : fetchGammaEventById;
    let release!: (value: unknown) => void;
    vi.mocked(polymarketPluginGet).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = read("123"); const second = read("123");
    expect(polymarketPluginGet).toHaveBeenCalledOnce();
    vi.setSystemTime(now + 500);
    const row = { id: "123", closed: false, live: true };
    release(kind === "market" ? [row] : row);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b); expect(a).not.toBe(b);
    Object.assign(a!, { live: false });
    expect(await read("123")).toMatchObject({ live: true });
    vi.setSystemTime(now + PM_GAMMA_CACHE_MS - 1);
    await read("123"); expect(polymarketPluginGet).toHaveBeenCalledOnce();
    vi.mocked(polymarketPluginGet).mockResolvedValue(kind === "market" ? [{ closed: true }] : { ended: true });
    vi.setSystemTime(now + PM_GAMMA_CACHE_MS);
    expect(await read("123")).toEqual(kind === "market" ? { closed: true } : { ended: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test("different event/token identities stay isolated and CLOB always refetches", async () => {
    vi.mocked(polymarketPluginGet).mockImplementation(async url => url.includes("/markets?") ? [{ closed: false }] : { live: true });
    await fetchGammaMarketByTokenId("a"); await fetchGammaMarketByTokenId("b");
    await fetchGammaEventById("a"); await fetchGammaEventById("b");
    await fetchClobMarketByConditionId("a"); await fetchClobMarketByConditionId("a");
    expect(polymarketPluginGet).toHaveBeenCalledTimes(6);
  });

  test.each([null, [], {}, "bad", { id: "a", title: "metadata only" }, { error: "unavailable" }])("invalid/empty event %j is not cached", async value => {
    vi.mocked(polymarketPluginGet).mockResolvedValue(value);
    await fetchGammaEventById("a"); await fetchGammaEventById("a");
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test("errors do not reuse expired successes or prevent a retry", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValueOnce({ live: true });
    await fetchGammaEventById("a"); vi.setSystemTime(now + PM_GAMMA_CACHE_MS);
    vi.mocked(polymarketPluginGet).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ended: true });
    await expect(fetchGammaEventById("a")).rejects.toThrow("offline");
    expect(await fetchGammaEventById("a")).toEqual({ ended: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(3);
  });

  test.each([null, [], {}, "bad", [{ error: "unavailable" }], [{ id: "a", title: "metadata only" }]])("invalid/empty market %j is not cached", async value => {
    vi.mocked(polymarketPluginGet).mockResolvedValue(value);
    expect(await fetchGammaMarketByTokenId("a")).toBeNull();
    vi.mocked(polymarketPluginGet).mockResolvedValue([{ closed: true }]);
    expect(await fetchGammaMarketByTokenId("a")).toEqual({ closed: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test.each(["market", "event"])("%s expires by monotonic time even if the wall clock still appears within TTL", async kind => {
    const read = kind === "market" ? fetchGammaMarketByTokenId : fetchGammaEventById;
    const tick = vi.spyOn(performance, "now").mockReturnValue(100);
    vi.mocked(polymarketPluginGet).mockResolvedValue(kind === "market" ? [{ closed: false }] : { live: true });
    await read("a");
    // 真实经过 2 秒，系统校时回拨后墙钟却只前进了半秒。
    tick.mockReturnValue(100 + PM_GAMMA_CACHE_MS);
    vi.setSystemTime(now + 500);
    vi.mocked(polymarketPluginGet).mockResolvedValue(kind === "market" ? [{ closed: true }] : { ended: true });
    expect(await read("a")).toEqual(kind === "market" ? { closed: true } : { ended: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test.each([
    { tokens: [{ token_id: "winner", winner: true }] },
    { clobTokenIds: '["a","b"]', outcomePrices: '["0","1"]' },
    { events: [{ ended: true }] },
  ])("preserves actionable market evidence %j without status flags", async row => {
    vi.mocked(polymarketPluginGet).mockResolvedValue([row]);
    expect(await fetchGammaMarketByTokenId("a")).toEqual(row);
    expect(await fetchGammaMarketByTokenId("a")).toEqual(row);
    expect(polymarketPluginGet).toHaveBeenCalledOnce();
  });

  test("slow responses and clock rollback cannot extend freshness", async () => {
    vi.mocked(polymarketPluginGet).mockImplementationOnce(async () => {
      vi.setSystemTime(now + PM_GAMMA_CACHE_MS); return { live: true };
    }).mockResolvedValue({ live: true });
    await fetchGammaEventById("a"); await fetchGammaEventById("a");
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
    vi.setSystemTime(now); await fetchGammaEventById("a");
    expect(polymarketPluginGet).toHaveBeenCalledTimes(3);
  });

  test("clearing an in-flight cache cannot restore its old result", async () => {
    let release!: (value: unknown) => void;
    vi.mocked(polymarketPluginGet).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const old = fetchGammaEventById("a"); clearPmGammaCacheForTests();
    vi.mocked(polymarketPluginGet).mockResolvedValue({ ended: true });
    await fetchGammaEventById("a"); release({ live: true }); await old;
    expect(await fetchGammaEventById("a")).toEqual({ ended: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test("completed cache stays bounded", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ live: true });
    for (let i = 0; i < 257; i++) await fetchGammaEventById(String(i));
    await fetchGammaEventById("256"); expect(polymarketPluginGet).toHaveBeenCalledTimes(257);
    await fetchGammaEventById("0"); expect(polymarketPluginGet).toHaveBeenCalledTimes(258);
  });
});
