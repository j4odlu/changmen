import { describe, expect, test } from "vitest";
import { parseEuroOddsPayload } from "./parse";
import { buildPbCollectMatchDto } from "./markets";
import { setPbChangmenExtensions } from "./extensionsMode";

describe("PB rotNum SaveMatch step1", () => {
  test("parseEuroOddsPayload keeps event.rotNum", () => {
    const { matches } = parseEuroOddsPayload({
      leagues: [
        {
          id: 1,
          gameCode: "valorant",
          gameName: "Valorant",
          name: "VCT",
          events: [
            {
              id: 1633896380,
              rotNum: "53830",
              time: 1_700_000_000_000,
              live: true,
              participants: [
                { type: "HOME", name: "KRU", englishName: "KRU" },
                { type: "AWAY", name: "BESTIA", englishName: "BESTIA" },
              ],
              periods: {
                "0": { moneyLine: { homePrice: 1.5, awayPrice: 2.5, lineId: 1 } },
              },
            },
          ],
        },
      ],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchId).toBe("1633896380");
    expect(matches[0]!.rotNum).toBe("53830");
  });

  test("A8 default: SaveMatch keeps SourceMatchID and omits RotNum", () => {
    setPbChangmenExtensions(false);
    const dto = buildPbCollectMatchDto({
      matchId: "1633896380",
      gameId: "valorant",
      gameCode: "valorant",
      gameName: "Valorant",
      leagueName: "VCT",
      bo: 3,
      startTime: 1_700_000_000_000,
      isLive: true,
      rotNum: "53830",
      home: { id: "kru", name: "KRU", englishName: "KRU" },
      away: { id: "bestia", name: "BESTIA", englishName: "BESTIA" },
      stages: [],
    });
    expect(dto.SourceMatchID).toBe("1633896380");
    expect(dto.RotNum).toBeUndefined();
    expect(dto.IsLive).toBe(1);
  });

  test("changmen extensions: SaveMatch includes RotNum without changing SourceMatchID", () => {
    setPbChangmenExtensions(true);
    try {
      const dto = buildPbCollectMatchDto({
        matchId: "1633896380",
        gameId: "valorant",
        gameCode: "valorant",
        gameName: "Valorant",
        leagueName: "VCT",
        bo: 3,
        startTime: 1_700_000_000_000,
        isLive: true,
        rotNum: "53830",
        home: { id: "kru", name: "KRU", englishName: "KRU" },
        away: { id: "bestia", name: "BESTIA", englishName: "BESTIA" },
        stages: [],
      });
      expect(dto.SourceMatchID).toBe("1633896380");
      expect(dto.RotNum).toBe("53830");
      expect(dto.IsLive).toBe(1);
    }
    finally {
      setPbChangmenExtensions(false);
    }
  });

  test("buildPbCollectMatchDto sets IsLive=0 for prematch", () => {
    const dto = buildPbCollectMatchDto({
      matchId: "1633957560",
      gameId: "cs2",
      gameCode: "cs2",
      gameName: "CS2",
      leagueName: "T",
      bo: 3,
      startTime: 1_700_000_000_000,
      isLive: false,
      rotNum: "51066",
      home: { id: "a", name: "A", englishName: "A" },
      away: { id: "b", name: "B", englishName: "B" },
      stages: [],
    });
    expect(dto.IsLive).toBe(0);
  });
});
