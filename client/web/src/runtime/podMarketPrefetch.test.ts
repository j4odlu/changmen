import { afterEach, describe, expect, it, vi } from "vitest";
import { mergePodBoardMarkets, prefetchObSportMatchMarkets, resetPodMarketPrefetch } from "@/runtime/podMarketPrefetch";

const fetchMarkets = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/obSportFootballFetch", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/runtime/obSportFootballFetch")>(),
  fetchObFootballMatchMarkets: fetchMarkets,
}));

afterEach(() => {
  resetPodMarketPrefetch();
  fetchMarkets.mockReset();
});

describe("pod market prefetch merge", () => {
  it("requests missing-line detail recovery and caches the recovered markets", async () => {
    fetchMarkets.mockResolvedValueOnce([{
      MarketCode: "totals", Line: 3.5, Selections: [
        { Side: "over", OddID: "over-target", Odds: 1.9 },
        { Side: "under", OddID: "under-target", Odds: 1.95 },
      ],
    }]);
    const rows = await prefetchObSportMatchMarkets("5505659");
    expect(fetchMarkets).toHaveBeenCalledWith("5505659", { includeDetail: true });
    expect(rows[0]).toMatchObject({ line: 3.5, oidHome: "over-target", oidAway: "under-target" });
    expect(await prefetchObSportMatchMarkets("5505659")).toEqual(rows);
    expect(fetchMarkets).toHaveBeenCalledTimes(1);
  });

  it("lets freshly prefetched market fields replace the board snapshot", () => {
    const rows = mergePodBoardMarkets([
      {
        id: 1,
        marketCode: "totals",
        line: 2.5,
        name: "old",
        ob: true,
        quoteHome: 1.8,
        quoteAway: 2,
        quoteDraw: 0,
        oidHome: "old-oid",
        oidAway: "old-away",
      },
    ], [
      {
        id: 2,
        marketCode: "totals",
        line: 2.5,
        name: "fresh",
        ob: true,
        quoteHome: 1.95,
        quoteAway: 1.9,
        quoteDraw: 0,
        oidHome: "fresh-oid",
        oidAway: "fresh-away",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "fresh", quoteHome: 1.95, oidHome: "fresh-oid" });
  });
});
