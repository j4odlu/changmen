import { describe, expect, it } from "vitest";
import {
  betKey,
  formatTitle,
  isPlaceholderTeamName,
  stableBetId,
  stableId,
  stablePendingBetId,
} from "../teams/match_utils.js";

describe("match_utils", () => {
  it("builds stable non-zero ids from the same seed", () => {
    expect(stableId("OB:match-1")).toBe(stableId("OB:match-1"));
    expect(stableId("OB:match-1")).not.toBe(stableId("RAY:match-1"));
    expect(stableId("")).toBe(1);
  });

  it("stableBetId is injective per (clientMatchId, map) without hash collision", () => {
    expect(stableBetId(100, 1)).toBe(100 * 4096 + 1);
    expect(stableBetId(100, 1)).toBe(stableBetId(100, 1));
    expect(stableBetId(100, 1)).not.toBe(stableBetId(200, 1));
    expect(stableBetId(100, 1)).not.toBe(stableBetId(100, 2));

    const ids = new Set();
    for (let m = 1; m <= 500; m++) {
      for (let map = 0; map <= 7; map++) {
        const id = stableBetId(m, map);
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
    }
  });

  it("stablePendingBetId hashes mergeKey scoped seeds", () => {
    const a = stablePendingBetId("mk:a|b", 1);
    const b = stablePendingBetId("mk:c|d", 1);
    expect(a).toBe(stablePendingBetId("mk:a|b", 1));
    expect(a).not.toBe(b);
  });

  it("formats match titles with useful fallbacks", () => {
    expect(formatTitle(" Team A ", " Team B ")).toBe("Team A vs Team B");
    expect(formatTitle("Team A", "")).toBe("Team A");
    expect(formatTitle("", "")).toBe("Unknown");
  });

  it("builds provider scoped bet keys and detects placeholder teams", () => {
    expect(betKey("OB", 123)).toBe("OB:123");
    expect(isPlaceholderTeamName("主队")).toBe(true);
    expect(isPlaceholderTeamName("客队")).toBe(true);
    expect(isPlaceholderTeamName("Unknown")).toBe(true);
    expect(isPlaceholderTeamName("Natus Vincere")).toBe(false);
  });
});
