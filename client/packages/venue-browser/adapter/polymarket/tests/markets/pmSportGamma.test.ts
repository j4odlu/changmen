import { gammaV1 } from "../fixtures/currentGamma";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearPmGammaCacheForTests, fetchGammaEventById, fetchGammaMarketByTokenId,
  fetchClobMarketByConditionId,
  gammaEventToPmSportLike,
} from "@changmen/venue-browser/polymarket/markets/pmSportGamma";
import { fetchGammaMarketByTokenId as legacyFetchGammaMarketByTokenId, gammaEventToPmSportLike as legacyGammaEventToPmSportLike } from "@changmen/venue-browser/polymarket/submission/preflight/legacy/pmSportGamma";
import { getPolymarketPmSportBlockReason } from "@changmen/venue-browser/polymarket/markets/pmSportGuard";
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

describe.each([fetchGammaMarketByTokenId, legacyFetchGammaMarketByTokenId])("version-aware Gamma lookup in both preflight modes", read => {
  test("falls back to position_ids and rejects a V2 response found through the old CTF ID", async () => {
    const market = { version: "v2", clobTokenIds: '["101","102"]', positionIds: ["201", "202"], closed: false };
    vi.mocked(polymarketPluginGet).mockImplementation(async url => new URL(url).searchParams.has("position_ids") ? [market] : []);
    expect(await read("201")).toEqual(market);
    const urls = vi.mocked(polymarketPluginGet).mock.calls.map(([url]) => new URL(url));
    expect(urls.map(url => url.searchParams.get("clob_token_ids") ?? url.searchParams.get("position_ids"))).toEqual(["201", "201"]);
    expect(urls[1]!.searchParams.get("position_ids")).toBe("201");
    expect(urls.every(url => url.searchParams.get("closed") === "any")).toBe(true);
    vi.mocked(polymarketPluginGet).mockResolvedValue([market]);
    await expect(read("101")).rejects.toThrow("交易资产或版本不一致");
  });
});

describe.each([gammaEventToPmSportLike, legacyGammaEventToPmSportLike])("PM score parsing in both preflight modes", (parseEvent) => {
  test("basketball points are preserved without a series or a map number", () => {
    const snapshot = parseEvent({ score: "79-71", period: "1Q", live: true, ended: false });
    expect(snapshot).toMatchObject({ scoreKind: "points", scoreRaw: "79-71", mapScore: { home: 79, away: 71 }, bo: null, currentMap: null });
    expect(getPolymarketPmSportBlockReason(snapshot, 0)).toBeNull();
    expect(getPolymarketPmSportBlockReason(snapshot, 1)).toBeNull();
    expect(getPolymarketPmSportBlockReason(parseEvent({ score: "110-108", ended: true }), 0)).toContain("比赛已结束");
  });

  test("LoL kills stay separate from series wins and BO3 victories still block", () => {
    const running = parseEvent({ score: "15-10|1-0|Bo3", period: "2/3", live: true });
    expect(running).toMatchObject({ scoreKind: "series", mapScore: { home: 1, away: 0 }, bo: 3, currentMap: 2 });
    expect(getPolymarketPmSportBlockReason(running, 0)).toBeNull();
    expect(getPolymarketPmSportBlockReason(running, 1)).toContain("地图1已结束");
    expect(getPolymarketPmSportBlockReason(parseEvent({ score: "15-10|2-0|Bo3", live: true }), 0)).toContain("系列赛已决出");
  });
});

describe("Gamma short cache", () => {
  test.each(["market", "event"])("%s coalesces concurrent reads and expires from request start", async kind => {
    const read = kind === "market" ? fetchGammaMarketByTokenId : fetchGammaEventById;
    let release!: (value: unknown) => void;
    vi.mocked(polymarketPluginGet).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = read("123"); const second = read("123");
    expect(polymarketPluginGet).toHaveBeenCalledOnce();
    vi.setSystemTime(now + 500);
    const row = gammaV1(["123", "124"], { id: "123", closed: false, live: true });
    release(kind === "market" ? [row] : row);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b); expect(a).not.toBe(b);
    Object.assign(a!, { live: false });
    expect(await read("123")).toMatchObject({ live: true });
    vi.setSystemTime(now + PM_GAMMA_CACHE_MS - 1);
    await read("123"); expect(polymarketPluginGet).toHaveBeenCalledOnce();
    vi.mocked(polymarketPluginGet).mockResolvedValue(kind === "market" ? [gammaV1(["123", "124"], { closed: true })] : { ended: true });
    vi.setSystemTime(now + PM_GAMMA_CACHE_MS);
    expect(await read("123")).toEqual(kind === "market" ? gammaV1(["123", "124"], { closed: true }) : { ended: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test("different event/token identities stay isolated and CLOB always refetches", async () => {
    vi.mocked(polymarketPluginGet).mockImplementation(async url => url.includes("/markets?") ? [gammaV1(["123", "124"], { closed: false })] : { live: true });
    await fetchGammaMarketByTokenId("123"); await fetchGammaMarketByTokenId("124");
    await fetchGammaEventById("123"); await fetchGammaEventById("124");
    await fetchClobMarketByConditionId("123"); await fetchClobMarketByConditionId("123");
    expect(polymarketPluginGet).toHaveBeenCalledTimes(6);
  });

  test.each([null, [], {}, "bad", { id: "123", title: "metadata only" }, { error: "unavailable" }])("invalid/empty event %j is not cached", async value => {
    vi.mocked(polymarketPluginGet).mockResolvedValue(value);
    await fetchGammaEventById("123"); await fetchGammaEventById("123");
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test("errors do not reuse expired successes or prevent a retry", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValueOnce({ live: true });
    await fetchGammaEventById("123"); vi.setSystemTime(now + PM_GAMMA_CACHE_MS);
    vi.mocked(polymarketPluginGet).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ended: true });
    await expect(fetchGammaEventById("123")).rejects.toThrow("offline");
    expect(await fetchGammaEventById("123")).toEqual({ ended: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(3);
  });

  test.each([null, [], {}, "bad", [{ error: "unavailable" }], [{ id: "123", title: "metadata only" }]])("invalid/empty market %j is not cached", async value => {
    vi.mocked(polymarketPluginGet).mockResolvedValue(value);
    expect(await fetchGammaMarketByTokenId("123")).toBeNull();
    vi.mocked(polymarketPluginGet).mockResolvedValue([gammaV1(["123", "124"], { closed: true })]);
    expect(await fetchGammaMarketByTokenId("123")).toEqual(gammaV1(["123", "124"], { closed: true }));
    expect(polymarketPluginGet).toHaveBeenCalledTimes(3);
  });

  test.each(["market", "event"])("%s expires by monotonic time even if the wall clock still appears within TTL", async kind => {
    const read = kind === "market" ? fetchGammaMarketByTokenId : fetchGammaEventById;
    const tick = vi.spyOn(performance, "now").mockReturnValue(100);
    vi.mocked(polymarketPluginGet).mockResolvedValue(kind === "market" ? [gammaV1(["123", "124"], { closed: false })] : { live: true });
    await read("123");
    // 真实经过 2 秒，系统校时回拨后墙钟却只前进了半秒。
    tick.mockReturnValue(100 + PM_GAMMA_CACHE_MS);
    vi.setSystemTime(now + 500);
    vi.mocked(polymarketPluginGet).mockResolvedValue(kind === "market" ? [gammaV1(["123", "124"], { closed: true })] : { ended: true });
    expect(await read("123")).toEqual(kind === "market" ? gammaV1(["123", "124"], { closed: true }) : { ended: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test.each([
    { tokens: [{ token_id: "123", winner: true }] },
    { version: "v1", clobTokenIds: '["123","124"]', outcomePrices: '["0","1"]' },
    { events: [{ ended: true }] },
  ])("preserves actionable market evidence %j without status flags", async row => {
    const current = gammaV1(["123", "124"], row);
    vi.mocked(polymarketPluginGet).mockResolvedValue([current]);
    expect(await fetchGammaMarketByTokenId("123")).toEqual(current);
    expect(await fetchGammaMarketByTokenId("123")).toEqual(current);
    expect(polymarketPluginGet).toHaveBeenCalledOnce();
  });

  test("slow responses and clock rollback cannot extend freshness", async () => {
    vi.mocked(polymarketPluginGet).mockImplementationOnce(async () => {
      vi.setSystemTime(now + PM_GAMMA_CACHE_MS); return { live: true };
    }).mockResolvedValue({ live: true });
    await fetchGammaEventById("123"); await fetchGammaEventById("123");
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
    vi.setSystemTime(now); await fetchGammaEventById("123");
    expect(polymarketPluginGet).toHaveBeenCalledTimes(3);
  });

  test("clearing an in-flight cache cannot restore its old result", async () => {
    let release!: (value: unknown) => void;
    vi.mocked(polymarketPluginGet).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const old = fetchGammaEventById("123"); clearPmGammaCacheForTests();
    vi.mocked(polymarketPluginGet).mockResolvedValue({ ended: true });
    await fetchGammaEventById("123"); release({ live: true }); await old;
    expect(await fetchGammaEventById("123")).toEqual({ ended: true });
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });

  test("completed cache stays bounded", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ live: true });
    for (let i = 0; i < 257; i++) await fetchGammaEventById(String(i));
    await fetchGammaEventById("256"); expect(polymarketPluginGet).toHaveBeenCalledTimes(257);
    await fetchGammaEventById("0"); expect(polymarketPluginGet).toHaveBeenCalledTimes(258);
  });
});
