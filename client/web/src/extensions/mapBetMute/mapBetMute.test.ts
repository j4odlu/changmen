import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_FOLDABLE_MAP,
  MAP_BET_MUTE_SESSION_KEY,
  MAP_BET_MUTE_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_MAP4_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY,
  MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY,
  canFoldMap,
  clearMapMute,
  isMapMuteActive,
  isMapMuteGlobal,
  isFullMatchMuteGlobal,
  isMap4MuteGlobal,
  isMap4MuteGlobalActive,
  setMap4MuteGlobal,
  toggleMap4MuteGlobal,
  isMapMuted,
  muteKey,
  resetMapBetMuteForTests,
  setMapMuteGlobal,
  setFullMatchMuteGlobal,
  toggleMapMute,
  toggleMapMuteGlobal,
  toggleFullMatchMuteGlobal,
} from "@/extensions/mapBetMute/mapBetMute";

function mockSessionStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
  });
}

describe("mapBetMute", () => {
  beforeEach(() => {
    mockSessionStorage();
    resetMapBetMuteForTests();
  });

  it("full match and all maps are foldable", () => {
    expect(MIN_FOLDABLE_MAP).toBe(0);
    expect(canFoldMap(-1)).toBe(false);
    expect(canFoldMap(0)).toBe(true);
    expect(canFoldMap(1)).toBe(true);
    expect(canFoldMap(2)).toBe(true);
    expect(canFoldMap(3)).toBe(true);
    expect(canFoldMap(4)).toBe(true);
    expect(canFoldMap(5)).toBe(true);
  });

  it("toggle no-ops for non-map rows", () => {
    expect(toggleMapMute(100, -1)).toBe(false);
    expect(isMapMuted(100, -1)).toBe(false);
    expect(sessionStorage.getItem(MAP_BET_MUTE_SESSION_KEY)).toBeNull();
  });

  it("toggle mutes and unmutes map 1", () => {
    expect(toggleMapMute(100, 1)).toBe(true);
    expect(isMapMuted(100, 1)).toBe(true);
    expect(toggleMapMute(100, 1)).toBe(false);
    expect(isMapMuted(100, 1)).toBe(false);
  });

  it("toggle mutes and unmutes full match", () => {
    expect(toggleMapMute(100, 0)).toBe(true);
    expect(isMapMuted(100, 0)).toBe(true);
    expect(isMapMuteActive(100, 0, 5)).toBe(true);
    expect(toggleMapMute(100, 0)).toBe(false);
    expect(isMapMuted(100, 0)).toBe(false);
  });

  it("toggle mutes and unmutes map 3", () => {
    expect(toggleMapMute(100, 3)).toBe(true);
    expect(isMapMuted(100, 3)).toBe(true);
    expect(toggleMapMute(100, 3)).toBe(false);
    expect(isMapMuted(100, 3)).toBe(false);
  });

  it("toggle mutes and unmutes map 5", () => {
    expect(isMapMuted(100, 5)).toBe(false);
    expect(toggleMapMute(100, 5)).toBe(true);
    expect(isMapMuted(100, 5)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(MAP_BET_MUTE_SESSION_KEY)!)).toEqual([
      muteKey(100, 5),
    ]);
    expect(toggleMapMute(100, 5)).toBe(false);
    expect(isMapMuted(100, 5)).toBe(false);
  });

  it("does not mute other maps on same match", () => {
    toggleMapMute(100, 5);
    expect(isMapMuted(100, 4)).toBe(false);
    expect(isMapMuted(100, 6)).toBe(false);
    expect(isMapMuted(101, 5)).toBe(false);
  });

  it("live round disables mute and clearMapMute removes key", () => {
    toggleMapMute(100, 5);
    expect(isMapMuteActive(100, 5, 0)).toBe(true);
    expect(isMapMuteActive(100, 5, 5)).toBe(false);
    expect(isMapMuteActive(100, 5, 4)).toBe(true);
    clearMapMute(100, 5);
    expect(isMapMuted(100, 5)).toBe(false);
  });

  it("global mute folds all foldable rounds including full match", () => {
    expect(isMapMuteGlobal()).toBe(false);
    expect(toggleMapMuteGlobal()).toBe(true);
    expect(isMapMuteGlobal()).toBe(true);
    expect(sessionStorage.getItem(MAP_BET_MUTE_GLOBAL_SESSION_KEY)).toBe("1");
    expect(isMapMuteActive(100, 0, 0)).toBe(true);
    expect(isMapMuteActive(100, 1, 0)).toBe(true);
    expect(isMapMuteActive(200, 5, 0)).toBe(true);
    expect(isMapMuteActive(100, -1, 0)).toBe(false);
  });

  it("global mute still respects live exemption", () => {
    setMapMuteGlobal(true);
    expect(isMapMuteActive(100, 3, 3)).toBe(false);
    expect(isMapMuteActive(100, 3, 2)).toBe(true);
    expect(isMapMuteActive(100, 0, 3)).toBe(true);
  });

  it("full-match global mute closes round 0 and leaves maps normal", () => {
    expect(isFullMatchMuteGlobal()).toBe(false);
    expect(toggleFullMatchMuteGlobal()).toBe(true);
    expect(sessionStorage.getItem(MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY)).toBe("1");
    expect(isMapMuteActive(100, 0, 0)).toBe(true);
    expect(isMapMuteActive(100, 0, 3)).toBe(true);
    expect(isMapMuteActive(100, 1, 0)).toBe(false);
    expect(isMapMuteActive(100, 3, 3)).toBe(false);
    expect(toggleMapMute(100, 0)).toBe(true);
    expect(isMapMuteActive(100, 0, 0)).toBe(true);
  });

  it("turning full-match global mute off restores full matches without changing map mutes", () => {
    toggleMapMute(100, 0);
    toggleMapMute(100, 2);
    setFullMatchMuteGlobal(true);
    expect(setFullMatchMuteGlobal(false)).toBe(false);
    expect(isMapMuteActive(100, 0, 0)).toBe(false);
    expect(isMapMuteActive(100, 2, 0)).toBe(true);
    expect(sessionStorage.getItem(MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY)).toBeNull();
  });

  it("turning global off clears all per-row mutes and exceptions", () => {
    toggleMapMute(100, 0);
    toggleMapMute(100, 2);
    toggleMapMute(101, 1);
    setMapMuteGlobal(true);
    expect(toggleMapMute(100, 1)).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY)!)).toEqual([
      muteKey(100, 1),
    ]);
    expect(setMapMuteGlobal(false)).toBe(false);
    expect(isMapMuteGlobal()).toBe(false);
    expect(isMapMuted(100, 0)).toBe(false);
    expect(isMapMuted(100, 2)).toBe(false);
    expect(isMapMuted(101, 1)).toBe(false);
    expect(isMapMuteActive(100, 0, 0)).toBe(false);
    expect(isMapMuteActive(100, 1, 0)).toBe(false);
    expect(sessionStorage.getItem(MAP_BET_MUTE_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(MAP_BET_MUTE_GLOBAL_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY)).toBeNull();
  });

  it("per-row toggle can open and re-fold while global is on", () => {
    setMapMuteGlobal(true);
    expect(isMapMuteActive(100, 1, 0)).toBe(true);
    expect(toggleMapMute(100, 1)).toBe(false);
    expect(isMapMuteActive(100, 1, 0)).toBe(false);
    expect(isMapMuteActive(100, 2, 0)).toBe(true);
    expect(toggleMapMute(100, 1)).toBe(true);
    expect(isMapMuteActive(100, 1, 0)).toBe(true);
  });

  it("clearMapMute under global keeps map open after live", () => {
    setMapMuteGlobal(true);
    expect(isMapMuteActive(100, 2, 0)).toBe(true);
    clearMapMute(100, 2);
    expect(isMapMuteActive(100, 2, 0)).toBe(false);
  });

  it("turning global on clears prior exceptions", () => {
    setMapMuteGlobal(true);
    toggleMapMute(100, 1);
    expect(isMapMuteActive(100, 1, 0)).toBe(false);
    setMapMuteGlobal(false);
    setMapMuteGlobal(true);
    expect(isMapMuteActive(100, 1, 0)).toBe(true);
    expect(sessionStorage.getItem(MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY)).toBeNull();
  });

  it("map4 global mute covers all matches including newly loaded ones, without muting other rounds", () => {
    expect(isMap4MuteGlobal()).toBe(false);
    expect(toggleMap4MuteGlobal()).toBe(true);
    expect(sessionStorage.getItem(MAP_BET_MUTE_MAP4_GLOBAL_SESSION_KEY)).toBe("1");
    for (const matchId of [100, 200, 300]) {
      for (const round of [-1, 0, 1, 2, 3, 4, 5])
        expect(isMapMuteActive(matchId, round, 0)).toBe(round === 4);
    }
    expect(toggleMapMute(100, 4)).toBe(true);
    expect(isMapMuted(100, 4)).toBe(false);
    expect(toggleMap4MuteGlobal()).toBe(false);
    expect(isMapMuteActive(100, 4, 0)).toBe(false);
  });

  it("live exemption is read-only until live cleanup records it for the rest of the cycle", () => {
    toggleMapMute(100, 4);
    setMap4MuteGlobal(true);
    expect(isMapMuteActive(100, 4, 4)).toBe(false);
    expect(isMap4MuteGlobalActive(100, 4, 4)).toBe(false);
    expect(sessionStorage.getItem(MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY)).toBeNull();
    clearMapMute(100, 4);
    expect(isMapMuted(100, 4)).toBe(false);
    expect(isMapMuteActive(100, 4, 5)).toBe(false);
    expect(isMapMuteActive(200, 4, 5)).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY)!)).toEqual(["100:4"]);
    // After automatic live recovery, the original row toggle remains usable.
    expect(toggleMapMute(100, 4)).toBe(true);
    expect(isMapMuteActive(100, 4, 5)).toBe(true);
    expect(toggleMapMute(100, 4)).toBe(false);
  });

  it("map4 overrides ordinary global open exceptions and survives restoring all markets", () => {
    setMapMuteGlobal(true);
    toggleMapMute(100, 4);
    setMap4MuteGlobal(true);
    expect(isMapMuteActive(100, 4, 0)).toBe(true);
    expect(toggleMapMute(100, 4)).toBe(true);
    setMapMuteGlobal(false);
    expect(isMapMuteActive(100, 4, 0)).toBe(true);
    expect(isMapMuteActive(100, 3, 0)).toBe(false);
  });

  it("restoring map4 preserves other row mutes, full-match closure and the all-market switch", () => {
    toggleMapMute(100, 4);
    toggleMapMute(100, 3);
    setFullMatchMuteGlobal(true);
    setMap4MuteGlobal(true);
    setMap4MuteGlobal(false);
    expect(isMapMuted(100, 4)).toBe(false);
    expect(isMapMuted(100, 3)).toBe(true);
    expect(isMapMuteActive(100, 0, 0)).toBe(true);
    expect(isMapMuteActive(100, 4, 0)).toBe(false);
    setMapMuteGlobal(true);
    toggleMapMute(100, 2);
    setMap4MuteGlobal(true);
    setMap4MuteGlobal(false);
    expect(isMapMuteActive(100, 4, 0)).toBe(true);
    expect(isMapMuteActive(100, 2, 0)).toBe(false);
    setFullMatchMuteGlobal(false);
    expect(isMapMuteActive(100, 4, 0)).toBe(true);
  });

  it("restoring all markets preserves map4 live records, while a new map4 cycle resets them", () => {
    setMapMuteGlobal(true);
    setMap4MuteGlobal(true);
    clearMapMute(100, 4);
    setMapMuteGlobal(false);
    expect(isMapMuteActive(100, 4, 5)).toBe(false);
    expect(isMapMuteActive(200, 4, 0)).toBe(true);
    setMap4MuteGlobal(false);
    expect(sessionStorage.getItem(MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY)).toBeNull();
    setMap4MuteGlobal(true);
    expect(isMapMuteActive(100, 4, 5)).toBe(true);
    expect(isMapMuteActive(100, 4, 4)).toBe(false);
  });

  it("restores map4 state and live exceptions after a session reload and resets both keys", () => {
    setMap4MuteGlobal(true);
    clearMapMute(100, 4);
    const flag = sessionStorage.getItem(MAP_BET_MUTE_MAP4_GLOBAL_SESSION_KEY)!;
    const liveKeys = sessionStorage.getItem(MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY)!;
    resetMapBetMuteForTests();
    expect(sessionStorage.getItem(MAP_BET_MUTE_MAP4_GLOBAL_SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY)).toBeNull();
    sessionStorage.setItem(MAP_BET_MUTE_MAP4_GLOBAL_SESSION_KEY, flag);
    sessionStorage.setItem(MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY, liveKeys);
    expect(isMap4MuteGlobal()).toBe(true);
    expect(isMapMuteActive(100, 4, 5)).toBe(false);
    expect(isMapMuteActive(200, 4, 0)).toBe(true);
  });

  it.each(["broken", "{}", "null"])("ignores invalid live records %s", (raw) => {
    sessionStorage.setItem(MAP_BET_MUTE_MAP4_GLOBAL_SESSION_KEY, "1");
    sessionStorage.setItem(MAP_BET_MUTE_MAP4_LIVE_OPEN_SESSION_KEY, raw);
    expect(isMapMuteActive(100, 4, 0)).toBe(true);
  });

  it("keeps the switch and live recovery usable when session storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    });
    expect(isMap4MuteGlobal()).toBe(false);
    setMap4MuteGlobal(true);
    expect(isMapMuteActive(100, 4, 0)).toBe(true);
    clearMapMute(100, 4);
    expect(isMapMuteActive(100, 4, 5)).toBe(false);
    setMap4MuteGlobal(false);
    expect(isMap4MuteGlobal()).toBe(false);
  });
});
