import { describe, expect, it } from "vitest";
import { PriceHistory, TREND_WINDOW_MS, trendPath } from "./history";

describe("PM price history", () => {
  it("keeps both intrasecond extremes while bounding a burst to four points", () => {
    const history = new PriceHistory();
    history.push(.5, 1_000);
    history.push(.8, 1_100);
    history.push(.2, 1_200);
    for (let i = 0; i < 500; i++) history.push(.6, 1_300 + i);
    expect(history.read(2_000)).toEqual([
      { at: 1_000, price: .5 }, { at: 1_100, price: .8 },
      { at: 1_200, price: .2 }, { at: 1_799, price: .6 },
    ]);
  });

  it("rejects malformed quotes and time reversal, expires old data even without new ticks", () => {
    const history = new PriceHistory();
    for (const price of [0, 1, -1, NaN, Infinity]) history.push(price, 1_000);
    history.push(.5, 1_000);
    history.push(.9, 999);
    expect(history.read(1_001)).toEqual([{ at: 1_000, price: .5 }]);
    expect(history.read(1_001 + TREND_WINDOW_MS)).toEqual([]);
  });

  it("retains quotes after ten minutes and expires them after thirty minutes", () => {
    const history = new PriceHistory();
    history.push(.5, 1_000);
    expect(history.read(1_000 + 20 * 60_000)).toEqual([{ at: 1_000, price: .5 }]);
    expect(history.read(1_001 + 30 * 60_000)).toEqual([]);
  });

  it("never grows beyond the thirty minute window and returns detached snapshots", () => {
    const history = new PriceHistory();
    for (let second = 0; second <= 7_200; second++) {
      for (let tick = 0; tick < 10; tick++) history.push(.1 + tick * .08, second * 1_000 + tick);
    }
    const points = history.read(7_200_009);
    expect(points.length).toBeLessThanOrEqual(1_801 * 4);
    expect(points[0]!.at).toBeGreaterThanOrEqual(7_200_009 - TREND_WINDOW_MS);
    points[0]!.price = .99;
    expect(history.read(7_200_009)[0]!.price).not.toBe(.99);
  });

  it("breaks paths across missing observations and does not interpolate prices", () => {
    const path = trendPath([{ at: 0, price: .5 }, { at: 1_000, price: .6 }, { at: 60_000, price: .3 }], TREND_WINDOW_MS);
    expect(path).toBe("M0.00,32.00 H0.16V25.60 M9.33,44.80");
    expect(trendPath([], TREND_WINDOW_MS)).toBe("");
  });
});
