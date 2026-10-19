import { describe, expect, test } from "vitest";
import {
  getPolymarketPmSportBlockReason,
  isPmSeriesDecided,
  isPmSportEnded,
} from "@changmen/venue-browser/polymarket/markets/pmSportGuard";

describe("isPmSportEnded", () => {
  test("ended flag", () => {
    expect(isPmSportEnded({ ended: true })).toBe(true);
    expect(isPmSportEnded({ ended: false, status: "running" })).toBe(false);
  });

  test("finished status", () => {
    expect(isPmSportEnded({ status: "finished" })).toBe(true);
    expect(isPmSportEnded({ status: "Final" })).toBe(true);
  });
});

describe("isPmSeriesDecided", () => {
  test("BO3 1-2 decided", () => {
    expect(isPmSeriesDecided({ mapScore: { home: 1, away: 2 }, bo: 3 })).toBe(true);
  });

  test("BO3 1-1 not decided", () => {
    expect(isPmSeriesDecided({ mapScore: { home: 1, away: 1 }, bo: 3 })).toBe(false);
  });

  test("BO3 2-0 decided", () => {
    expect(isPmSeriesDecided({ mapScore: { home: 2, away: 0 }, bo: 3 })).toBe(true);
  });
});

describe("getPolymarketPmSportBlockReason", () => {
  test("no pm_sport does not block", () => {
    expect(getPolymarketPmSportBlockReason(null, 0)).toBeNull();
  });

  test("blocks full series when 1-2", () => {
    const reason = getPolymarketPmSportBlockReason(
      { mapScore: { home: 1, away: 2 }, bo: 3, status: "running" },
      0,
    );
    expect(reason).toContain("系列赛已决出");
  });

  test("blocks map 1 when current map is 3", () => {
    const reason = getPolymarketPmSportBlockReason(
      { mapScore: { home: 1, away: 1 }, bo: 3, period: "3/3", currentMap: 3, live: true },
      1,
    );
    expect(reason).toContain("地图1已结束");
  });

  test("LYON case: ended blocks even without series check first", () => {
    const reason = getPolymarketPmSportBlockReason(
      { ended: true, mapScore: { home: 1, away: 2 }, bo: 3 },
      0,
    );
    expect(reason).toContain("比赛已结束");
  });
});
