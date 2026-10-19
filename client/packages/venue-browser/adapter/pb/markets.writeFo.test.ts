import { beforeEach, describe, expect, test, vi } from "vitest";

const saveVenueOdds = vi.hoisted(() => vi.fn());
const setPbLineId = vi.hoisted(() => vi.fn());
const rememberPbRotEvent = vi.hoisted(() => vi.fn());

vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  saveVenueOdds,
}));

vi.mock("./lineCache", () => ({
  setPbLineId,
}));

vi.mock("./wsShadowOdds", () => ({
  rememberPbRotEvent,
  upsertPbWsShadowFromParsedMatch: vi.fn(),
}));

vi.mock("./wsStatusPoll", () => ({
  isPbWsShadowUiAllowed: () => false,
}));

import { ingestAndReportPbParsedMatch } from "./markets";
import { setPbChangmenExtensions } from "./extensionsMode";
import type { PbParsedMatch } from "./parse";

const ROW: PbParsedMatch = {
  matchId: "1",
  gameId: "cs-go",
  gameCode: "cs2",
  gameName: "CS2",
  leagueName: "L",
  bo: 3,
  startTime: 1,
  isLive: false,
  home: { id: "h", name: "H", englishName: "H" },
  away: { id: "a", name: "A", englishName: "A" },
  stages: [
    {
      stageId: 0,
      label: "全场",
      winHome: 1.9,
      winAway: 2.0,
      winHomeId: "h1",
      winAwayId: "a1",
      winMarketId: "m1",
      winLineId: 42,
      winLocked: false,
      betName: "胜负",
    },
  ],
};

describe("ingestAndReportPbParsedMatch writeFo", () => {
  beforeEach(() => {
    saveVenueOdds.mockReset();
    setPbLineId.mockReset();
    rememberPbRotEvent.mockReset();
    setPbChangmenExtensions(false);
  });

  test("writeFo false still syncs lineId, skips fo", () => {
    ingestAndReportPbParsedMatch(ROW, 100, { writeFo: false });
    expect(setPbLineId).toHaveBeenCalledWith("m1", 42);
    expect(saveVenueOdds).not.toHaveBeenCalled();
  });

  test("writeFo true writes fo and lineId", () => {
    ingestAndReportPbParsedMatch(ROW, 100, { writeFo: true });
    expect(setPbLineId).toHaveBeenCalledWith("m1", 42);
    expect(saveVenueOdds).toHaveBeenCalled();
  });

  test("A8 default: omits RotNum and does not remember rot event", () => {
    const row = { ...ROW, rotNum: "53830" };
    const { match } = ingestAndReportPbParsedMatch(row, 100, { writeFo: true });
    expect(match.RotNum).toBeUndefined();
    expect(rememberPbRotEvent).not.toHaveBeenCalled();
  });

  test("changmen extensions: SaveMatch includes RotNum and remembers rot", () => {
    setPbChangmenExtensions(true);
    const row = { ...ROW, rotNum: "53830" };
    const { match } = ingestAndReportPbParsedMatch(row, 100, { writeFo: true });
    expect(match.RotNum).toBe("53830");
    expect(rememberPbRotEvent).toHaveBeenCalledWith("1", "53830");
    setPbChangmenExtensions(false);
  });
});
