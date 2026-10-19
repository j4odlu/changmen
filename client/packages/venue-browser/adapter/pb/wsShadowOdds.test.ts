import { beforeEach, describe, expect, test } from "vitest";
import { selectionId } from "./parse";
import {
  clearPbWsShadow,
  getPbWsShadow,
  rememberPbRotEvent,
  replacePbWsShadowFromBoard,
  resetPbWsShadowForTests,
  resolvePbWsShadow,
  savePbWsShadow,
  seedPbWsShadowFromHttp,
  upsertPbWsShadowFromParsedMatch,
} from "./wsShadowOdds";

describe("pb wsShadowOdds", () => {
  beforeEach(() => {
    resetPbWsShadowForTests();
  });

  test("save/get/clear do not require oddsStore", () => {
    savePbWsShadow("a|0|1|0|0|0|0", { odds: 1.5, isLock: false, source: "M" });
    expect(getPbWsShadow("a|0|1|0|0|0|0")?.odds).toBe(1.5);
    expect(getPbWsShadow("a|0|1|0|0|0|0")?.source).toBe("M");
    clearPbWsShadow();
    expect(getPbWsShadow("a|0|1|0|0|0|0")).toBeUndefined();
  });

  test("replaceFromBoard maps selectionId like HTTP fo with source M + text", () => {
    replacePbWsShadowFromBoard([
      {
        eventId: 1634107465,
        period: 1,
        betType: 1,
        home: "1.373",
        away: "3.060",
      },
    ]);
    const home = getPbWsShadow(selectionId(1634107465, 1, "HOME"));
    expect(home?.odds).toBe(1.373);
    expect(home?.source).toBe("M");
    expect(home?.text).toBe("1.373");
    expect(getPbWsShadow(selectionId(1634107465, 1, "AWAY"))?.odds).toBe(3.06);
  });

  test("skips alt per side (does not drop the other side)", () => {
    replacePbWsShadowFromBoard([
      {
        eventId: 1,
        period: 0,
        betType: 1,
        home: "1.2",
        away: "3.3",
        homeAlt: 1,
      },
    ]);
    expect(getPbWsShadow(selectionId(1, 0, "HOME"))).toBeUndefined();
    expect(getPbWsShadow(selectionId(1, 0, "AWAY"))?.odds).toBe(3.3);
  });

  test("board still carrying price keeps shadow when away updates (updateOdds empty-no-erase on board)", () => {
    replacePbWsShadowFromBoard([
      {
        eventId: 7,
        period: 2,
        betType: 1,
        home: "2.870",
        away: "1.395",
      },
    ]);
    expect(getPbWsShadow(selectionId(7, 2, "HOME"))?.odds).toBe(2.87);
    // 板卡仍带旧 home（WS 空 oddFm 不擦格）；镜像整表重建后 home 仍在
    replacePbWsShadowFromBoard([
      {
        eventId: 7,
        period: 2,
        betType: 1,
        home: "2.870",
        away: "1.111",
      },
    ]);
    expect(getPbWsShadow(selectionId(7, 2, "HOME"))?.odds).toBe(2.87);
    expect(getPbWsShadow(selectionId(7, 2, "AWAY"))?.odds).toBe(1.111);
  });

  test("alt-both omits period from mirror", () => {
    replacePbWsShadowFromBoard([
      {
        eventId: 9,
        period: 2,
        betType: 1,
        home: "2.870",
        away: "1.395",
      },
      {
        eventId: 9,
        period: 0,
        betType: 1,
        home: "1.80",
        away: "2.00",
      },
    ]);
    replacePbWsShadowFromBoard([
      {
        eventId: 9,
        period: 2,
        betType: 1,
        home: "9.99",
        away: "1.01",
        homeAlt: 1,
        awayAlt: 1,
      },
      {
        eventId: 9,
        period: 0,
        betType: 1,
        home: "1.85",
        away: "1.95",
      },
    ]);
    expect(getPbWsShadow(selectionId(9, 2, "HOME"))).toBeUndefined();
    expect(getPbWsShadow(selectionId(9, 0, "HOME"))?.odds).toBe(1.85);
  });

  test("seedPbWsShadowFromHttp is no-op (fo must not fake official shadow)", () => {
    const id = selectionId(50, 1, "HOME");
    seedPbWsShadowFromHttp(id, 1.9);
    expect(getPbWsShadow(id)).toBeUndefined();
    replacePbWsShadowFromBoard([
      { eventId: 50, period: 1, betType: 1, home: "2.05", away: "1.80" },
    ]);
    expect(getPbWsShadow(id)?.source).toBe("M");
    expect(getPbWsShadow(id)?.odds).toBe(2.05);
    seedPbWsShadowFromHttp(id, 1.578);
    expect(getPbWsShadow(id)?.odds).toBe(2.05);
    expect(getPbWsShadow(id)?.source).toBe("M");
  });

  test("newer official board price updates M", () => {
    const id = selectionId(60, 0, "HOME");
    replacePbWsShadowFromBoard([
      { eventId: 60, period: 0, betType: 1, home: "1.581", away: "2.41", homePriceAt: 100, awayPriceAt: 100 },
    ]);
    expect(getPbWsShadow(id)?.odds).toBe(1.581);
    replacePbWsShadowFromBoard([
      { eventId: 60, period: 0, betType: 1, home: "1.578", away: "2.41", homePriceAt: 200, awayPriceAt: 200 },
    ]);
    expect(getPbWsShadow(id)?.source).toBe("M");
    expect(getPbWsShadow(id)?.odds).toBe(1.578);
    expect(getPbWsShadow(id)?.text).toBe("1.578");
  });

  test("empty board does not clear existing cells", () => {
    replacePbWsShadowFromBoard([
      { eventId: 3, period: 0, betType: 1, home: "1.2", away: "2.2" },
    ]);
    replacePbWsShadowFromBoard([]);
    expect(getPbWsShadow(selectionId(3, 0, "HOME"))?.odds).toBe(1.2);
  });

  test("does not steal another match price by period alone", () => {
    replacePbWsShadowFromBoard([
      { eventId: 111, period: 2, betType: 1, home: "1.5", away: "2.5" },
    ]);
    expect(
      resolvePbWsShadow({
        oddId: selectionId(222, 2, "HOME"),
        map: 2,
      }),
    ).toBeUndefined();
  });

  test("S1: map1 row must not pick period-0 via matchId rebuild", () => {
    replacePbWsShadowFromBoard([
      { eventId: 111, period: 0, betType: 1, home: "1.5", away: "2.5" },
      { eventId: 111, period: 1, betType: 1, home: "3.0", away: "1.4" },
    ]);
    expect(
      resolvePbWsShadow({
        oddId: selectionId(111, 0, "HOME"),
        map: 1,
      }),
    ).toBeUndefined();
    expect(
      resolvePbWsShadow({
        oddId: selectionId(111, 1, "HOME"),
        map: 1,
      })?.odds,
    ).toBe(3);
  });

  test("exact eventId+period hits", () => {
    replacePbWsShadowFromBoard([
      { eventId: 222, period: 1, betType: 1, home: "1.11", away: "3.33" },
    ]);
    expect(
      resolvePbWsShadow({
        oddId: selectionId(222, 1, "HOME"),
        map: 1,
      })?.odds,
    ).toBe(1.11);
  });

  test("shadow mirrors board layer: period absent from board is absent from byOddId", () => {
    replacePbWsShadowFromBoard([
      { eventId: 77, period: 0, betType: 1, home: "1.495", away: "2.550" },
      { eventId: 77, period: 3, betType: 1, home: "1.143", away: "5.39" },
    ]);
    expect(getPbWsShadow(selectionId(77, 3, "HOME"))?.odds).toBe(1.143);
    replacePbWsShadowFromBoard([
      { eventId: 77, period: 0, betType: 1, home: "1.500", away: "2.540" },
    ]);
    expect(getPbWsShadow(selectionId(77, 0, "HOME"))?.odds).toBe(1.5);
    expect(getPbWsShadow(selectionId(77, 3, "HOME"))).toBeUndefined();
    expect(getPbWsShadow(selectionId(77, 3, "AWAY"))).toBeUndefined();
  });

  test("period-0 board must not be readable as map3 shadow", () => {
    replacePbWsShadowFromBoard([
      { eventId: 88, period: 0, betType: 1, home: "1.495", away: "2.550" },
    ]);
    expect(
      resolvePbWsShadow({
        oddId: selectionId(88, 3, "HOME"),
        map: 3,
      }),
    ).toBeUndefined();
    expect(
      resolvePbWsShadow({
        oddId: selectionId(88, 0, "HOME"),
        map: 0,
      })?.odds,
    ).toBe(1.495);
  });

  test("rememberPbRotEvent does not invent prices", () => {
    rememberPbRotEvent(1, "99");
    expect(getPbWsShadow(selectionId(1, 0, "HOME"))).toBeUndefined();
  });

  test("unique rot+period aliases onto remembered sibling HomeID (not fo)", () => {
    rememberPbRotEvent("111", "53830");
    rememberPbRotEvent("222", "53830");
    replacePbWsShadowFromBoard([
      {
        eventId: 111,
        period: 0,
        betType: 1,
        rotNum: "53830",
        home: "1.80",
        away: "2.00",
      },
    ]);
    expect(resolvePbWsShadow({ oddId: selectionId(111, 0, "HOME"), map: 0 })?.odds).toBe(1.8);
    expect(resolvePbWsShadow({ oddId: selectionId(222, 0, "HOME"), map: 0 })?.odds).toBe(1.8);
    expect(resolvePbWsShadow({ oddId: selectionId(222, 2, "HOME"), map: 2 })).toBeUndefined();
  });

  test("unique rot+period aliases when board rotNum empty but collect remembered", () => {
    rememberPbRotEvent("111", "53830");
    rememberPbRotEvent("222", "53830");
    replacePbWsShadowFromBoard([
      { eventId: 111, period: 0, betType: 1, home: "1.80", away: "2.00" },
    ]);
    expect(resolvePbWsShadow({ oddId: selectionId(222, 0, "HOME"), map: 0 })?.odds).toBe(1.8);
  });

  test("matchId fallback uses Matchs.PB at same period only", () => {
    replacePbWsShadowFromBoard([
      { eventId: 111, period: 0, betType: 1, home: "1.80", away: "2.00" },
    ]);
    expect(
      resolvePbWsShadow({
        oddId: selectionId(222, 0, "HOME"),
        matchId: "111",
        map: 0,
      })?.odds,
    ).toBe(1.8);
    expect(
      resolvePbWsShadow({
        oddId: selectionId(222, 1, "HOME"),
        matchId: "111",
        map: 1,
      }),
    ).toBeUndefined();
  });

  test("two events same rot+period on board: no sibling alias", () => {
    rememberPbRotEvent("111", "1");
    rememberPbRotEvent("222", "1");
    rememberPbRotEvent("333", "1");
    replacePbWsShadowFromBoard([
      { eventId: 111, period: 0, betType: 1, rotNum: "1", home: "1.80", away: "2.00" },
      { eventId: 222, period: 0, betType: 1, rotNum: "1", home: "1.90", away: "2.10" },
    ]);
    expect(resolvePbWsShadow({ oddId: selectionId(111, 0, "HOME"), map: 0 })?.odds).toBe(1.8);
    expect(resolvePbWsShadow({ oddId: selectionId(222, 0, "HOME"), map: 0 })?.odds).toBe(1.9);
    expect(resolvePbWsShadow({ oddId: selectionId(333, 0, "HOME"), map: 0 })).toBeUndefined();
  });

  test("collect euro seeds periods the observe board does not have", () => {
    upsertPbWsShadowFromParsedMatch({
      matchId: "1634270069",
      gameId: "lol",
      gameCode: "lol",
      gameName: "lol",
      leagueName: "",
      bo: 5,
      startTime: 1,
      isLive: true,
      rotNum: "31386",
      home: { id: "a", name: "A", englishName: "A" },
      away: { id: "b", name: "B", englishName: "B" },
      stages: [
        {
          stageId: 0,
          label: "全场",
          winHome: 3.56,
          winAway: 1.28,
          winHomeId: selectionId(1634270069, 0, "HOME"),
          winAwayId: selectionId(1634270069, 0, "AWAY"),
          winMarketId: "1634270069:0",
          winLocked: false,
          betName: "全场",
        },
        {
          stageId: 3,
          label: "地图3",
          winHome: 3.56,
          winAway: 1.28,
          winHomeId: selectionId(1634270069, 3, "HOME"),
          winAwayId: selectionId(1634270069, 3, "AWAY"),
          winMarketId: "1634270069:3",
          winLocked: false,
          betName: "地图3",
        },
      ],
    });
    replacePbWsShadowFromBoard([
      { eventId: 1634270069, period: 0, betType: 1, home: "3.600", away: "1.270" },
    ]);
    expect(resolvePbWsShadow({ oddId: selectionId(1634270069, 0, "HOME"), map: 0 })?.text).toBe("3.600");
    expect(resolvePbWsShadow({ oddId: selectionId(1634270069, 3, "HOME"), map: 3 })?.odds).toBe(3.56);
  });
});
