import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARP_PLATFORM,
  clampValueBetEdgePctRange,
  clampValueBetOddsRange,
  coerceValueBetAutoBetRuntime,
  evMarkerFloor,
  normalizeValueBetOdds,
  normalizePmMaxOverroundPct,
  resolveSoftPlatforms,
  resolveSoftPlatformsFromAllowed,
  valueBetCalcOptsFromPrefs,
} from "@/extensions/valueBet/evConfig";
import { filterArbProviderKeys } from "@/types/extensionPrefs";

describe("resolveSoftPlatforms", () => {
  it("excludes PB and keeps RAY when sharp is PB", () => {
    const soft = resolveSoftPlatforms("PB");
    expect(soft).not.toContain("PB");
    expect(soft).toContain("RAY");
    expect(soft).toContain("OB");
  });

  it("excludes RAY and includes PB when sharp is RAY", () => {
    const soft = resolveSoftPlatforms("RAY");
    expect(soft).not.toContain("RAY");
    expect(soft).toContain("PB");
    expect(soft).toContain("OB");
  });

  it("excludes OB and includes PB/RAY when sharp is OB", () => {
    const soft = resolveSoftPlatforms("OB");
    expect(soft).not.toContain("OB");
    expect(soft).toContain("PB");
    expect(soft).toContain("RAY");
  });
});

describe("valueBetCalcOptsFromPrefs", () => {
  it("defaults to PB / 3% with near floor 1%", () => {
    const opts = valueBetCalcOptsFromPrefs(null);
    expect(opts.sharp).toBe(DEFAULT_SHARP_PLATFORM);
    expect(opts.minEdge).toBe(0.03);
    expect(opts.pmMaxOverroundPct).toBe(3);
    expect(opts.nearEdge).toBe(0.01);
    expect(opts.softPlatforms).toEqual(resolveSoftPlatforms("PB"));
  });

  it("reads RAY baseline and minEdge; near stays 1%", () => {
    const opts = valueBetCalcOptsFromPrefs({ sharp: "RAY", minEdgePct: 5 });
    expect(opts.sharp).toBe("RAY");
    expect(opts.minEdge).toBe(0.05);
    expect(opts.nearEdge).toBe(0.01);
    expect(opts.softPlatforms).toEqual(resolveSoftPlatforms("RAY"));
  });

  it("reads OB baseline", () => {
    const opts = valueBetCalcOptsFromPrefs({ sharp: "OB", minEdgePct: 4 });
    expect(opts.sharp).toBe("OB");
    expect(opts.minEdge).toBe(0.04);
    expect(opts.softPlatforms).toEqual(resolveSoftPlatforms("OB"));
  });

  it("reads PM baseline and excludes it from the selected EV targets", () => {
    const opts = valueBetCalcOptsFromPrefs({
      sharp: "Polymarket",
      minEdgePct: 4,
      softPlatforms: ["Polymarket", "PB", "RAY", "OB"],
    });
    expect(opts.sharp).toBe("Polymarket");
    expect(opts.minEdge).toBe(0.04);
    expect(opts.softPlatforms).toEqual(["OB", "RAY", "PB"]);
    expect(valueBetCalcOptsFromPrefs({ sharp: "Polymarket", softPlatforms: ["Polymarket"] }).softPlatforms)
      .toEqual([]);
  });

  it("caps near at minEdge when 正EV is below 1%", () => {
    const opts = valueBetCalcOptsFromPrefs({ minEdgePct: 0.5 });
    expect(opts.minEdge).toBe(0.005);
    expect(opts.nearEdge).toBe(0.005);
    expect(evMarkerFloor(opts.nearEdge, opts.minEdge)).toBe(0.005);
  });

  it("clamps out-of-range minEdge instead of reverting to defaults", () => {
    const opts = valueBetCalcOptsFromPrefs({ minEdgePct: 99 });
    expect(opts.minEdge).toBe(0.2);
    expect(opts.nearEdge).toBe(0.01);
  });

  it("honors softPlatforms subset and excludes sharp", () => {
    const opts = valueBetCalcOptsFromPrefs({
      sharp: "PB",
      softPlatforms: ["IA", "OB", "PB"],
    });
    // 顺序跟 VALUE_BET_SOFT_CANDIDATES 一致
    expect(opts.softPlatforms).toEqual(["OB", "IA"]);
  });

  it("uses no EV targets when softPlatforms is only the sharp venue", () => {
    const opts = valueBetCalcOptsFromPrefs({
      sharp: "PB",
      softPlatforms: ["PB"],
    });
    expect(opts.softPlatforms).toEqual([]);
  });
});

describe("resolveSoftPlatformsFromAllowed", () => {
  it("filters to allowed then excludes sharp", () => {
    expect(resolveSoftPlatformsFromAllowed("RAY", ["OB", "RAY", "IA"])).toEqual(["OB", "IA"]);
  });

  it("returns empty when allowed is only sharp", () => {
    expect(resolveSoftPlatformsFromAllowed("OB", ["OB"])).toEqual([]);
  });
});

describe("PM baseline overround settings", () => {
  it.each([undefined, null, "", Number.NaN, Infinity, "invalid", false, {}, []])("defaults invalid input %s to 3%%", (raw) => {
    expect(normalizePmMaxOverroundPct(raw)).toBe(3);
  });

  it("clamps to 0–100%, rounds to one decimal and propagates the configured limit", () => {
    expect(normalizePmMaxOverroundPct(-1)).toBe(0);
    expect(normalizePmMaxOverroundPct(101)).toBe(100);
    expect(normalizePmMaxOverroundPct("2.56")).toBe(2.6);
    expect(valueBetCalcOptsFromPrefs({ sharp: "Polymarket", pmMaxOverroundPct: 1.5 }).pmMaxOverroundPct).toBe(1.5);
  });
});

describe("filterArbProviderKeys", () => {
  it("passes through when allowed is null or empty", () => {
    expect(filterArbProviderKeys(["PB", "RAY"], null)).toEqual(["PB", "RAY"]);
    expect(filterArbProviderKeys(["PB", "RAY"], [])).toEqual(["PB", "RAY"]);
  });

  it("intersects funded with allowlist", () => {
    expect(filterArbProviderKeys(["PB", "RAY", "OB"], ["OB", "PB"])).toEqual(["PB", "OB"]);
  });
});

describe("valueBet autoBet range helpers", () => {
  it("clamps maxOdds up to minOdds when inverted", () => {
    expect(clampValueBetOddsRange(2.5, 1.2)).toEqual({ minOdds: 2.5, maxOdds: 2.5 });
    expect(clampValueBetOddsRange(1.3, 10)).toEqual({ minOdds: 1.3, maxOdds: 10 });
  });

  it("clamps maxEdgePct up to minEdgePct when inverted", () => {
    expect(clampValueBetEdgePctRange(8, 3)).toEqual({ minEdgePct: 8, maxEdgePct: 8 });
    expect(clampValueBetEdgePctRange(3, 8)).toEqual({ minEdgePct: 3, maxEdgePct: 8 });
  });

  it("clamps odds to 1.01–20", () => {
    expect(normalizeValueBetOdds(0.5, 1.3)).toBe(1.01);
    expect(normalizeValueBetOdds(99, 10)).toBe(20);
    expect(normalizeValueBetOdds("1.85", 1.3)).toBe(1.85);
  });

  it("coerces cleared autoBet fields to defaults instead of 0", () => {
    expect(coerceValueBetAutoBetRuntime({
      minEdgePct: null,
      maxEdgePct: null,
      minOdds: null,
      maxOdds: null,
      maxPerMap: null,
    })).toEqual({
      minEdgePct: 3,
      maxEdgePct: 20,
      minOdds: 1.3,
      maxOdds: 10,
      maxPerMap: 1,
      minEdge: 0.03,
      maxEdge: 0.2,
    });
  });
});
