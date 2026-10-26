import { describe, expect, test } from "vitest";
import {
  getPolymarketPmSportBlockReason,
  isPmSeriesDecided,
  isPmSportEnded,
  parsePeriodHead,
} from "@changmen/venue-browser/polymarket/markets/pmSportGuard";

describe("isPmSportEnded", () => {
  test("ended flag", () => {
    expect(isPmSportEnded({ ended: true })).toBe(true);
    expect(isPmSportEnded({ ended: false, status: "running" })).toBe(false);
  });

  test("finished status", () => {
    expect(isPmSportEnded({ status: "finished" })).toBe(true);
    expect(isPmSportEnded({ status: "Final" })).toBe(true);
    expect(isPmSportEnded({ status: "F/OT" })).toBe(true);
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

  test("basketball points never decide a series, including old snapshots", () => {
    for (const mapScore of [{ home: 79, away: 71 }, { home: 2, away: 0 }]) {
      expect(isPmSeriesDecided({ mapScore })).toBe(false);
      expect(isPmSeriesDecided({ mapScore, scoreKind: "points", bo: 3 })).toBe(false);
      expect(isPmSeriesDecided({ mapScore, scoreRaw: `${mapScore.home}-${mapScore.away}`, bo: 3 })).toBe(false);
    }
  });

  test("missing or invalid BO cannot invent a series victory threshold", () => {
    for (const bo of [undefined, null, 0, 1, 2.5, NaN, Infinity])
      expect(isPmSeriesDecided({ bo, scoreKind: "series", mapScore: { home: 2, away: 0 } })).toBe(false);
    expect(isPmSeriesDecided({ bo: 5, mapScore: { home: 2, away: 0 } })).toBe(false);
    expect(isPmSeriesDecided({ bo: 5, mapScore: { home: 3, away: 0 } })).toBe(true);
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

  test("Q4 basketball remains quotable until an explicit terminal state", () => {
    const snapshot = { live: true, status: "InProgress", period: "Q4", scoreRaw: "79-71", mapScore: { home: 79, away: 71 } };
    expect(getPolymarketPmSportBlockReason(snapshot, 0)).toBeNull();
    // 旧快照即使残留错误的地图编号，也不能把体育分节盘口当旧地图。
    expect(getPolymarketPmSportBlockReason({ ...snapshot, currentMap: 4 }, 1)).toBeNull();
    for (const status of ["finished", "Final", "F/OT"])
      expect(getPolymarketPmSportBlockReason({ ...snapshot, status }, 0)).toContain("比赛已结束");
    expect(getPolymarketPmSportBlockReason({ ...snapshot, ended: true }, 0)).toContain("比赛已结束");
  });

  test("sports quarters cannot be parsed as map numbers", () => {
    for (const period of ["1Q", "2Q", "Q4", "1H", "2H", "OT", "End Q2", "3/2"])
      expect(parsePeriodHead(period)).toBeNull();
    expect(parsePeriodHead("2/3")).toBe(2);
    expect(parsePeriodHead("2")).toBe(2);
  });
});
