import { afterEach, describe, expect, it, vi } from "vitest";

const fetchObFootballMatchMarkets = vi.fn();

vi.mock("@/runtime/obSportFootballFetch", () => ({
  fetchObFootballMatchMarkets: (...args: unknown[]) => fetchObFootballMatchMarkets(...args),
}));

const { isFootballObMarketsComplete, loadFootballObMarkets, peekFootballObMarkets, invalidateFootballObMarkets }
  = await import("@/runtime/footballObMarkets");

describe("footballObMarkets cache", () => {
  afterEach(() => {
    invalidateFootballObMarkets("m1");
    fetchObFootballMatchMarkets.mockReset();
  });

  it("treats an empty fetch as complete so the card does not keep reloading", async () => {
    fetchObFootballMatchMarkets.mockResolvedValueOnce([]);
    const rows = await loadFootballObMarkets("m1");
    expect(rows).toEqual([]);
    expect(isFootballObMarketsComplete(peekFootballObMarkets("m1"))).toBe(true);
    await loadFootballObMarkets("m1");
    expect(fetchObFootballMatchMarkets).toHaveBeenCalledTimes(1);
  });

  it("coalesces forced play refreshes while the same match is still loading", async () => {
    let finish!: (rows: unknown[]) => void;
    fetchObFootballMatchMarkets.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = loadFootballObMarkets("m1");
    expect(loadFootballObMarkets("m1", true)).toBe(first);
    expect(loadFootballObMarkets("m1", true)).toBe(first);
    expect(fetchObFootballMatchMarkets).toHaveBeenCalledTimes(1);
    finish([]);
    await first;
    fetchObFootballMatchMarkets.mockResolvedValueOnce([]);
    await loadFootballObMarkets("m1", true);
    expect(fetchObFootballMatchMarkets).toHaveBeenCalledTimes(2);
  });
});
