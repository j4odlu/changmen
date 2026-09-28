import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_FOLDABLE_MAP,
  MAP_BET_MUTE_SESSION_KEY,
  MAP_BET_MUTE_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_FULL_MATCH_GLOBAL_SESSION_KEY,
  MAP_BET_MUTE_GLOBAL_OPEN_SESSION_KEY,
  canFoldMap,
  clearMapMute,
  isMapMuteActive,
  isMapMuteGlobal,
  isFullMatchMuteGlobal,
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
});
