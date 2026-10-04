import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSportOddsStore } from "@/stores/sportOddsStore";
import { hasPrefetchedObOdds, peekPrefetchedObOdds, prefetchObSportOidQuote, resetPodMarketPrefetch } from "@/runtime/podMarketPrefetch";

const mocks = vi.hoisted(() => ({ post: vi.fn(), token: "trial-1" }));
vi.mock("@/runtime/obSportFootballFetch", () => ({ postObSportPb: mocks.post, fetchObFootballMatchMarkets: vi.fn() }));
vi.mock("@/runtime/obSportSessionLocal", () => ({ readLocalSportObSession: () => ({ token: mocks.token, gateway: "https://trial.example" }) }));
beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers(); vi.setSystemTime(100000); mocks.post.mockReset(); mocks.token = "trial-1"; resetPodMarketPrefetch(); });
afterEach(() => { resetPodMarketPrefetch(); vi.useRealTimers(); });
it("refreshes quote age even for unchanged WS prices and expires silent feeds", () => {
  const odds = useSportOddsStore();
  odds.save("OB", "oid", 1.95);
  vi.advanceTimersByTime(4000);
  odds.save("OB", "oid", 1.95);
  vi.advanceTimersByTime(4000);
  expect(odds.hasFresh("OB", "oid")).toBe(true);
  vi.advanceTimersByTime(1001);
  expect(odds.hasFresh("OB", "oid")).toBe(false);
});
it("uses trial HTTP and isolates quotes after a trial session change", async () => {
  mocks.post.mockResolvedValue({ mid: "5505659", hps: [{ hpid: "2", hl: [{ hid: "hid", hv: "2.5", ol: [{ oid: "oid", ot: "Over", ov: 195000 }] }] }] });
  expect(await prefetchObSportOidQuote("oid", "5505659")).toBe(1.95);
  expect(mocks.post.mock.calls[0]?.[0]).toContain("getMatchBaseInfoByOddsPB");
  expect(mocks.post.mock.calls[0]?.[2]).toMatchObject({ token: "trial-1" });
  expect(peekPrefetchedObOdds("oid")).toBe(1.95);
  mocks.token = "trial-2";
  expect(hasPrefetchedObOdds("oid")).toBe(false);
  expect(peekPrefetchedObOdds("oid")).toBe(0);
});
it("shares one HTTP snapshot for different selections in the same match and expires it", async () => {
  mocks.post.mockResolvedValue({ mid: "5505659", hps: [{ hpid: "2", hl: [{ hid: "hid", hv: "2.5", ol: [
    { oid: "over", ot: "Over", ov: 195000 }, { oid: "under", ot: "Under", ov: 0 },
  ] }] }] });
  expect(await prefetchObSportOidQuote("over", "5505659")).toBe(1.95);
  expect(await prefetchObSportOidQuote("under", "5505659")).toBe(0);
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(hasPrefetchedObOdds("under")).toBe(true);
  vi.advanceTimersByTime(3001);
  expect(hasPrefetchedObOdds("under")).toBe(false);
  await prefetchObSportOidQuote("under", "5505659");
  expect(mocks.post).toHaveBeenCalledTimes(2);
});
it("does not let a reset before the first microtask install a stale inflight request", async () => {
  mocks.post.mockResolvedValue({ mid: "5505659", hps: [{ hpid: "2", hl: [{ hid: "hid", hv: "2.5", ol: [{ oid: "over", ot: "Over", ov: 195000 }] }] }] });
  const old = prefetchObSportOidQuote("over", "5505659");
  resetPodMarketPrefetch();
  expect(await old).toBe(0);
  expect(await prefetchObSportOidQuote("over", "5505659")).toBe(1.95);
  vi.advanceTimersByTime(3001);
  expect(await prefetchObSportOidQuote("over", "5505659")).toBe(1.95);
  expect(mocks.post).toHaveBeenCalledTimes(2);
});
