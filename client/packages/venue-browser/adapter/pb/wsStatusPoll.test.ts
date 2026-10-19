import { beforeEach, describe, expect, test, vi } from "vitest";
import { selectionId } from "./parse";
import {
  getPbWsShadow,
  resetPbWsShadowForTests,
  savePbWsShadow,
  upsertPbWsShadowFromParsedMatch,
} from "./wsShadowOdds";
import {
  ingestShadow,
  mapObserveToStatus,
  resetPbWsShadowUiAllowedForTests,
  setPbWsShadowUiAllowed,
} from "./wsStatusPoll";

describe("mapObserveToStatus", () => {
  test("connected when observe reports connected", () => {
    expect(mapObserveToStatus({ enabled: true, observe: { connected: true } })).toBe(
      "connected",
    );
  });

  test("connecting while observe enabled but not yet connected", () => {
    expect(
      mapObserveToStatus({
        enabled: true,
        pageDetected: true,
        observe: { running: true, phase: "hook_start" },
      }),
    ).toBe("connecting");
  });

  test("readyState OPEN counts as connected (socket already up)", () => {
    expect(
      mapObserveToStatus({
        enabled: true,
        observe: {
          connected: false,
          readyState: 1,
          phase: "hooked",
          frameCount: 0,
        },
      }),
    ).toBe("connected");
  });

  test("inbound PING/CONNECTED counts as connected even if boolean was wiped", () => {
    expect(
      mapObserveToStatus({
        enabled: true,
        observe: {
          connected: false,
          phase: "hooked",
          frameCount: 12,
          lastType: "PING",
        },
      }),
    ).toBe("connected");
  });

  test("readyState CLOSED is error even if phase still hooked", () => {
    expect(
      mapObserveToStatus({
        enabled: true,
        observe: { connected: false, readyState: 3, phase: "hooked", latestOdds: [{ eventId: 1 }] },
      }),
    ).toBe("error");
  });

  test("ws_closed is disconnected even with leftover lastType", () => {
    expect(
      mapObserveToStatus({
        enabled: true,
        observe: { phase: "ws_closed", lastType: "PING", frameCount: 9 },
      }),
    ).toBe("disconnected");
  });

  test("error when lastError set and not connected", () => {
    expect(
      mapObserveToStatus({ enabled: true, observe: { lastError: "boom", connected: false } }),
    ).toBe("error");
  });

  test("enabled without a PB page stays disconnected", () => {
    expect(
      mapObserveToStatus({ enabled: true, observe: { running: true, phase: "hook_start" } }),
    ).toBe("disconnected");
    expect(
      mapObserveToStatus({
        enabled: true,
        pageDetected: false,
        observe: { phase: "hooked", latestOdds: [{ eventId: 1, via: "http" }] },
      }),
    ).toBe("disconnected");
  });

  test("WS-tagged board without handshake is page-detected, not pulsing", () => {
    expect(
      mapObserveToStatus({
        enabled: true,
        pageDetected: true,
        observe: {
          phase: "hooked",
          latestOdds: [{ eventId: 1, period: 0, via: "ws", home: "1.5" }],
        },
      }),
    ).toBe("detected");
  });

  test("HTTP-only board with page detected is solid detected", () => {
    expect(
      mapObserveToStatus({
        enabled: true,
        pageDetected: true,
        observe: {
          phase: "hooked",
          latestOdds: [{ eventId: 1, period: 0, via: "http", home: "1.5" }],
        },
      }),
    ).toBe("detected");
  });

  test("disconnected when empty", () => {
    expect(mapObserveToStatus(null)).toBe("disconnected");
    expect(mapObserveToStatus({ enabled: false, observe: {} })).toBe("disconnected");
  });
});

describe("ingestShadow prefs gate", () => {
  beforeEach(() => {
    resetPbWsShadowForTests();
    setPbWsShadowUiAllowed(false);
  });

  test("prefs off clears even if observe has board", () => {
    savePbWsShadow(selectionId(1, 0, "HOME"), { odds: 1.5, isLock: false });
    setPbWsShadowUiAllowed(false);
    ingestShadow({
      enabled: true,
      observe: {
        connected: true,
        latestOdds: [{ eventId: 1, period: 0, betType: 1, home: "1.9", away: "2.0" }],
      },
    });
    expect(getPbWsShadow(selectionId(1, 0, "HOME"))).toBeUndefined();
  });

  test("prefs on + observe on ingests board", () => {
    setPbWsShadowUiAllowed(true);
    ingestShadow({
      enabled: true,
      observe: {
        connected: true,
        latestOdds: [{ eventId: 9, period: 1, betType: 1, home: "1.11", away: "3.33" }],
      },
    });
    expect(getPbWsShadow(selectionId(9, 1, "HOME"))?.odds).toBe(1.11);
  });

  test("turning prefs off clears residual board", () => {
    setPbWsShadowUiAllowed(true);
    ingestShadow({
      enabled: true,
      observe: {
        connected: true,
        latestOdds: [{ eventId: 3, period: 0, betType: 1, home: "1.2", away: "2.2" }],
      },
    });
    expect(getPbWsShadow(selectionId(3, 0, "HOME"))?.odds).toBe(1.2);
    setPbWsShadowUiAllowed(false);
    expect(getPbWsShadow(selectionId(3, 0, "HOME"))).toBeUndefined();
    // false→false 也必须保持空表
    setPbWsShadowUiAllowed(false);
    expect(getPbWsShadow(selectionId(3, 0, "HOME"))).toBeUndefined();
  });

  test("unset gate falls back to localStorage both-on", () => {
    resetPbWsShadowUiAllowedForTests();
    const store = new Map<string, string>([
      ["changmen:pbExtensions", "1"],
      ["changmen:pbWsShadowUi", "1"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    try {
      ingestShadow({
        observe: {
          connected: true,
          latestOdds: [{ eventId: 4, period: 0, betType: 1, home: "1.4", away: "2.4" }],
        },
      });
      expect(getPbWsShadow(selectionId(4, 0, "HOME"))?.odds).toBe(1.4);
    }
    finally {
      vi.unstubAllGlobals();
    }
  });

  test("unset shadow key still ingests when extensions on", () => {
    resetPbWsShadowUiAllowedForTests();
    const store = new Map<string, string>([["changmen:pbExtensions", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    try {
      ingestShadow({
        observe: {
          connected: true,
          latestOdds: [{ eventId: 6, period: 0, betType: 1, home: "1.6", away: "2.6" }],
        },
      });
      expect(getPbWsShadow(selectionId(6, 0, "HOME"))?.odds).toBe(1.6);
    }
    finally {
      vi.unstubAllGlobals();
    }
  });

  test("enabled omitted still ingests when prefs on", () => {
    setPbWsShadowUiAllowed(true);
    ingestShadow({
      observe: {
        connected: true,
        latestOdds: [{ eventId: 5, period: 0, betType: 1, home: "1.5", away: "2.5" }],
      },
    });
    expect(getPbWsShadow(selectionId(5, 0, "HOME"))?.odds).toBe(1.5);
  });

  test("board ingest does not wipe collect euro periods", () => {
    setPbWsShadowUiAllowed(true);
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
    ingestShadow({
      enabled: true,
      observe: {
        connected: true,
        latestOdds: [
          { eventId: 1634270069, period: 0, betType: 1, home: "3.600", away: "1.270" },
        ],
      },
    });
    expect(getPbWsShadow(selectionId(1634270069, 0, "HOME"))?.text).toBe("3.600");
    expect(getPbWsShadow(selectionId(1634270069, 3, "HOME"))?.odds).toBe(3.56);
  });
});
