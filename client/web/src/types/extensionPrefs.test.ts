import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultExtensionPrefs,
  isArbAllowedPlatformOn,
  normalizeExtensionPrefs,
  serializeExtensionPrefsForSave,
  toggleArbAllowedPlatform,
} from "@/types/extensionPrefs";

const defaultStakeScale = {
  enabled: false,
  minImplied: 1.05,
  multiplier: 2,
  skipAccountRateOnScale: false,
};

const defaultValueBet = {
  sharp: "PB" as const,
  minEdgePct: 3,
  autoBet: {
    enabled: false,
    minEdgePct: 3,
    maxEdgePct: 20,
    minOdds: 1.3,
    maxOdds: 10,
    maxPerMap: 1,
  },
};

const defaultPrefs = {
  betRowUi: false,
  valueBet: defaultValueBet,
  valueBetSoftPlatforms: ["OB", "RAY", "IA", "SABA", "IMT", "Polymarket", "PB"],
  arbAllowedPlatforms: null,
  singleLeg9999Precheck: true,
  singleLeg9999UseValueBetMoney: false,
  singleLeg9999MaxPerMap: 1,
  stakeScaleByProfit: defaultStakeScale,
  arbFailAutoSell: { enabled: false },
  rayLateRejectAutoMakeup: { enabled: false, monitorMinutes: 5 },
  arbEarlyLockSell: { enabled: false, mode: "floor" as const, minExtraProfitPct: 0 },
  pmArbOrderMode: "FOK" as const,
  pmArbPriceBuffer: { enabled: false, multiplier: 1.01 },
  pmFokDepthBuffer: { enabled: false, multiplier: 1.5 },
  pfArbPriceBuffer: { enabled: false, multiplier: 1.01 },
  makeupOddsBand: {
    enabled: false,
    mode: "oddsFactor" as const,
    upper: 1.02,
    lower: 0.96,
    upperProfitPct: 4,
    lowerLossPct: 3,
  },
  uiTheme: "default" as const,
};

describe("extensionPrefs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults old or invalid PM mode preferences to FOK without changing other settings", () => {
    for (const raw of [{}, { pmArbOrderMode: "FOK" }, { pmArbOrderMode: "gtc" }, { pmArbOrderMode: "invalid" }, { pmArbOrderMode: null }]) {
      expect(normalizeExtensionPrefs(raw)).toEqual(defaultPrefs);
    }
  });

  it("round-trips the GTC placeholder through Extensions without changing other preferences", () => {
    const prefs = normalizeExtensionPrefs({ ...defaultPrefs, pmArbOrderMode: "GTC" });
    expect(prefs).toEqual({ ...defaultPrefs, pmArbOrderMode: "GTC" });
    expect(normalizeExtensionPrefs(JSON.parse(serializeExtensionPrefsForSave(prefs))))
      .toEqual(prefs);
  });

  it("defaults valueBet marker prefs to PB / 3%", () => {
    expect(createDefaultExtensionPrefs().valueBet).toEqual(defaultValueBet);
    expect(normalizeExtensionPrefs({}).valueBet).toEqual(defaultValueBet);
  });

  it("accepts RAY/OB as valueBet sharp and clamps out-of-range thresholds", () => {
    expect(normalizeExtensionPrefs({
      valueBet: { sharp: "RAY", minEdgePct: 5 },
    }).valueBet).toEqual({
      sharp: "RAY",
      minEdgePct: 5,
      autoBet: defaultValueBet.autoBet,
    });
    expect(normalizeExtensionPrefs({
      valueBet: { sharp: "OB", minEdgePct: 4 },
    }).valueBet).toEqual({
      sharp: "OB",
      minEdgePct: 4,
      autoBet: defaultValueBet.autoBet,
    });
    expect(normalizeExtensionPrefs({
      valueBet: { sharp: "IA", minEdgePct: 99 },
    }).valueBet).toEqual({
      sharp: "PB",
      minEdgePct: 20,
      autoBet: defaultValueBet.autoBet,
    });
  });

  it("drops legacy nearEdgePct from saved valueBet prefs", () => {
    const vb = normalizeExtensionPrefs({
      valueBet: { sharp: "PB", minEdgePct: 3, nearEdgePct: 8 },
    }).valueBet;
    expect(vb).toEqual({ sharp: "PB", minEdgePct: 3, autoBet: defaultValueBet.autoBet });
    expect(vb).not.toHaveProperty("nearEdgePct");
  });

  it("defaults EV autoBet off with 3–20% / 1.3–10 odds", () => {
    expect(createDefaultExtensionPrefs().valueBet.autoBet).toEqual(defaultValueBet.autoBet);
    expect(normalizeExtensionPrefs({
      valueBet: { sharp: "RAY", minEdgePct: 5 },
    }).valueBet.autoBet).toEqual(defaultValueBet.autoBet);
  });

  it("reads EV autoBet prefs and clamps odds range", () => {
    expect(normalizeExtensionPrefs({
      valueBet: {
        autoBet: { enabled: true, minEdgePct: 6, minOdds: 1.8, maxOdds: 2.4 },
      },
    }).valueBet.autoBet).toEqual({
      enabled: true,
      minEdgePct: 6,
      maxEdgePct: 20,
      minOdds: 1.8,
      maxOdds: 2.4,
      maxPerMap: 1,
    });
    expect(normalizeExtensionPrefs({
      valueBet: {
        autoBet: { enabled: true, minEdgePct: 4, minOdds: 2.5, maxOdds: 1.2 },
      },
    }).valueBet.autoBet).toEqual({
      enabled: true,
      minEdgePct: 4,
      maxEdgePct: 20,
      minOdds: 2.5,
      maxOdds: 2.5,
      maxPerMap: 1,
    });
  });

  it("reads EV autoBet edge range and clamps inverted max", () => {
    expect(normalizeExtensionPrefs({
      valueBet: {
        autoBet: { enabled: true, minEdgePct: 5, maxEdgePct: 8 },
      },
    }).valueBet.autoBet).toMatchObject({ minEdgePct: 5, maxEdgePct: 8 });
    expect(normalizeExtensionPrefs({
      valueBet: {
        autoBet: { enabled: true, minEdgePct: 8, maxEdgePct: 3 },
      },
    }).valueBet.autoBet).toMatchObject({ minEdgePct: 8, maxEdgePct: 8 });
  });

  it("reads and clamps EV autoBet maxPerMap", () => {
    expect(normalizeExtensionPrefs({
      valueBet: { autoBet: { maxPerMap: 3 } },
    }).valueBet.autoBet.maxPerMap).toBe(3);
    expect(normalizeExtensionPrefs({
      valueBet: { autoBet: { maxPerMap: 0 } },
    }).valueBet.autoBet.maxPerMap).toBe(1);
    expect(normalizeExtensionPrefs({
      valueBet: { autoBet: { maxPerMap: 99 } },
    }).valueBet.autoBet.maxPerMap).toBe(20);
  });

  it("defaults betRowUi to false and singleLeg9999Precheck to true", () => {
    expect(createDefaultExtensionPrefs()).toEqual(defaultPrefs);
  });

  it("normalizes missing payload", () => {
    expect(normalizeExtensionPrefs(null)).toEqual(defaultPrefs);
  });

  it("respects explicit true", () => {
    expect(normalizeExtensionPrefs({ betRowUi: true })).toEqual({
      ...defaultPrefs,
      betRowUi: true,
    });
  });

  it("can disable singleLeg9999Precheck", () => {
    expect(normalizeExtensionPrefs({ singleLeg9999Precheck: false })).toEqual({
      ...defaultPrefs,
      singleLeg9999Precheck: false,
    });
  });

  it("can enable singleLeg9999UseValueBetMoney", () => {
    expect(normalizeExtensionPrefs({ singleLeg9999UseValueBetMoney: true })).toEqual({
      ...defaultPrefs,
      singleLeg9999UseValueBetMoney: true,
    });
  });

  it("reads and clamps singleLeg9999MaxPerMap", () => {
    expect(normalizeExtensionPrefs({ singleLeg9999MaxPerMap: 3 }).singleLeg9999MaxPerMap).toBe(3);
    expect(normalizeExtensionPrefs({ singleLeg9999MaxPerMap: 0 }).singleLeg9999MaxPerMap).toBe(1);
    expect(normalizeExtensionPrefs({ singleLeg9999MaxPerMap: 99 }).singleLeg9999MaxPerMap).toBe(20);
  });

  it("ignores legacy pmAutoExitSell key (feature removed)", () => {
    expect(normalizeExtensionPrefs({ pmAutoExitSell: true })).toEqual(defaultPrefs);
  });

  it("forces arbFailAutoSell off while temporarily locked", () => {
    expect(normalizeExtensionPrefs({
      arbFailAutoSell: { enabled: true },
    }).arbFailAutoSell).toEqual({ enabled: false });
  });

  it("defaults arbFailAutoSell off", () => {
    expect(normalizeExtensionPrefs({}).arbFailAutoSell).toEqual({ enabled: false });
  });

  it("defaults RAY late-reject monitoring to 5 minutes and normalizes the user setting", () => {
    expect(normalizeExtensionPrefs({}).rayLateRejectAutoMakeup).toEqual({
      enabled: false,
      monitorMinutes: 5,
    });
    expect(normalizeExtensionPrefs({
      rayLateRejectAutoMakeup: { enabled: true, monitorMinutes: 12 },
    }).rayLateRejectAutoMakeup).toEqual({ enabled: true, monitorMinutes: 12 });
    expect(normalizeExtensionPrefs({
      rayLateRejectAutoMakeup: { monitorMinutes: 0 },
    }).rayLateRejectAutoMakeup.monitorMinutes).toBe(1);
    expect(normalizeExtensionPrefs({
      rayLateRejectAutoMakeup: { monitorMinutes: 99 },
    }).rayLateRejectAutoMakeup.monitorMinutes).toBe(60);
  });

  it("can enable arbEarlyLockSell (dual prediction only; mode ignored by runtime)", () => {
    expect(normalizeExtensionPrefs({
      arbEarlyLockSell: { enabled: true, mode: "pmEdge", minExtraProfitPct: 5 },
    }).arbEarlyLockSell).toEqual({
      enabled: true,
      mode: "pmEdge",
      minExtraProfitPct: 5,
    });
    expect(normalizeExtensionPrefs({
      arbEarlyLockSell: { enabled: true, mode: "nope", minExtraProfitPct: "x" },
    }).arbEarlyLockSell).toEqual({
      enabled: true,
      mode: "floor",
      minExtraProfitPct: 0,
    });
  });

  it("clamps invalid minExtraProfitPct to default", () => {
    expect(normalizeExtensionPrefs({
      arbEarlyLockSell: { enabled: true, minExtraProfitPct: 999 },
    }).arbEarlyLockSell.minExtraProfitPct).toBe(0);
    expect(normalizeExtensionPrefs({
      arbEarlyLockSell: { enabled: true, minExtraProfitPct: -1 },
    }).arbEarlyLockSell.minExtraProfitPct).toBe(0);
  });

  it("defaults arbEarlyLockSell off", () => {
    expect(normalizeExtensionPrefs({}).arbEarlyLockSell).toEqual({
      enabled: false,
      mode: "floor",
      minExtraProfitPct: 0,
    });
  });

  it("ignores legacy venueHkEgress / pmHkEgress keys", () => {
    expect(normalizeExtensionPrefs({ venueHkEgress: true, pmHkEgress: true })).toEqual(defaultPrefs);
  });

  it("normalizes stakeScaleByProfit", () => {
    expect(normalizeExtensionPrefs({
      stakeScaleByProfit: {
        enabled: true,
        minImplied: 1.08,
        multiplier: 1.5,
        skipAccountRateOnScale: true,
      },
    })).toEqual({
      ...defaultPrefs,
      stakeScaleByProfit: {
        enabled: true,
        minImplied: 1.08,
        multiplier: 1.5,
        skipAccountRateOnScale: true,
      },
    });
  });

  it("falls back invalid stakeScaleByProfit numbers", () => {
    expect(normalizeExtensionPrefs({
      stakeScaleByProfit: { enabled: true, minImplied: 0.9, multiplier: -2 },
    }).stakeScaleByProfit).toEqual({
      enabled: true,
      minImplied: 1.05,
      multiplier: 2,
      skipAccountRateOnScale: false,
    });
  });

  it("accepts uiTheme variants and falls back unknown", () => {
    expect(normalizeExtensionPrefs({ uiTheme: "brutal" }).uiTheme).toBe("brutal");
    expect(normalizeExtensionPrefs({ uiTheme: "paper" }).uiTheme).toBe("paper");
    expect(normalizeExtensionPrefs({ uiTheme: "terminal" }).uiTheme).toBe("terminal");
    expect(normalizeExtensionPrefs({ uiTheme: "neon" }).uiTheme).toBe("default");
    expect(normalizeExtensionPrefs({}).uiTheme).toBe("default");
  });

  it("defaults pmArbPriceBuffer off at 1.01", () => {
    expect(createDefaultExtensionPrefs().pmArbPriceBuffer).toEqual({
      enabled: false,
      multiplier: 1.01,
    });
    expect(normalizeExtensionPrefs({
      pmArbPriceBuffer: { enabled: true, multiplier: 1.03 },
    }).pmArbPriceBuffer).toEqual({ enabled: true, multiplier: 1.03 });
    expect(normalizeExtensionPrefs({
      pmArbPriceBuffer: { enabled: true, multiplier: 2 },
    }).pmArbPriceBuffer.multiplier).toBe(1.01);
  });

  it("defaults pmFokDepthBuffer off at 1.5", () => {
    expect(createDefaultExtensionPrefs().pmFokDepthBuffer).toEqual({
      enabled: false,
      multiplier: 1.5,
    });
    expect(normalizeExtensionPrefs({
      pmFokDepthBuffer: { enabled: true, multiplier: 2 },
    }).pmFokDepthBuffer).toEqual({ enabled: true, multiplier: 2 });
    expect(normalizeExtensionPrefs({
      pmFokDepthBuffer: { enabled: true, multiplier: 11 },
    }).pmFokDepthBuffer.multiplier).toBe(1.5);
  });

  it("defaults pfArbPriceBuffer off at 1.01", () => {
    expect(createDefaultExtensionPrefs().pfArbPriceBuffer).toEqual({
      enabled: false,
      multiplier: 1.01,
    });
    expect(normalizeExtensionPrefs({
      pfArbPriceBuffer: { enabled: true, multiplier: 1.03 },
    }).pfArbPriceBuffer).toEqual({ enabled: true, multiplier: 1.03 });
    expect(normalizeExtensionPrefs({
      pfArbPriceBuffer: { enabled: true, multiplier: 2 },
    }).pfArbPriceBuffer.multiplier).toBe(1.01);
  });

  it("ignores legacy pbWsShadowUi from RDS Extensions payload", () => {
    expect(normalizeExtensionPrefs({ pbWsShadowUi: true })).toEqual(defaultPrefs);
    expect("pbWsShadowUi" in normalizeExtensionPrefs({ pbWsShadowUi: true })).toBe(false);
  });

  it("defaults valueBetSoftPlatforms to full soft candidate list", () => {
    expect(createDefaultExtensionPrefs().valueBetSoftPlatforms).toEqual(
      defaultPrefs.valueBetSoftPlatforms,
    );
    expect(normalizeExtensionPrefs({}).valueBetSoftPlatforms).toEqual(
      defaultPrefs.valueBetSoftPlatforms,
    );
  });

  it("normalizes valueBetSoftPlatforms: drops unknown, keeps candidate order, empty→default", () => {
    expect(normalizeExtensionPrefs({
      valueBetSoftPlatforms: ["IA", "Nope", "OB", "IA"],
    }).valueBetSoftPlatforms).toEqual(["OB", "IA"]);
    expect(normalizeExtensionPrefs({
      valueBetSoftPlatforms: [],
    }).valueBetSoftPlatforms).toEqual(defaultPrefs.valueBetSoftPlatforms);
    expect(normalizeExtensionPrefs({
      valueBetSoftPlatforms: ["PredictFun"],
    }).valueBetSoftPlatforms).toEqual(defaultPrefs.valueBetSoftPlatforms);
  });

  it("defaults makeupOddsBand off in legacy odds-factor mode", () => {
    expect(createDefaultExtensionPrefs().makeupOddsBand).toEqual({
      enabled: false,
      mode: "oddsFactor",
      upper: 1.02,
      lower: 0.96,
      upperProfitPct: 4,
      lowerLossPct: 3,
    });
    expect(normalizeExtensionPrefs({
      makeupOddsBand: { enabled: true, upper: 1.03, lower: 0.95 },
    }).makeupOddsBand).toEqual({
      enabled: true,
      mode: "oddsFactor",
      upper: 1.03,
      lower: 0.95,
      upperProfitPct: 4,
      lowerLossPct: 3,
    });
    expect(normalizeExtensionPrefs({
      makeupOddsBand: { enabled: true, upper: 0.9, lower: 1.1 },
    }).makeupOddsBand).toEqual({
      enabled: true,
      mode: "oddsFactor",
      upper: 1.02,
      lower: 0.96,
      upperProfitPct: 4,
      lowerLossPct: 3,
    });
    expect(normalizeExtensionPrefs({
      makeupOddsBand: { enabled: true, upper: 1.02, lower: 0 },
    }).makeupOddsBand.lower).toBe(0);
    expect(normalizeExtensionPrefs({
      makeupOddsBand: { enabled: true, upper: 1.02, lower: 0.3 },
    }).makeupOddsBand.lower).toBe(0.5);
    expect(normalizeExtensionPrefs({
      makeupOddsBand: { enabled: true, upper: 1.02, lower: null },
    }).makeupOddsBand.lower).toBe(0.96);
    expect(normalizeExtensionPrefs({
      makeupOddsBand: {
        enabled: true,
        mode: "profitRate",
        upper: 1.02,
        lower: 0.96,
        upperProfitPct: 4.126,
        lowerLossPct: 2.555,
      },
    }).makeupOddsBand).toMatchObject({
      mode: "profitRate",
      upperProfitPct: 4.13,
      lowerLossPct: 2.56,
    });
  });

  it("defaults arbAllowedPlatforms to null (unrestricted)", () => {
    expect(createDefaultExtensionPrefs().arbAllowedPlatforms).toBeNull();
    expect(normalizeExtensionPrefs({}).arbAllowedPlatforms).toBeNull();
  });

  it("normalizes arbAllowedPlatforms: empty/invalid → null; keeps known ids", () => {
    expect(normalizeExtensionPrefs({
      arbAllowedPlatforms: [],
    }).arbAllowedPlatforms).toBeNull();
    expect(normalizeExtensionPrefs({
      arbAllowedPlatforms: "PB",
    }).arbAllowedPlatforms).toBeNull();
    expect(normalizeExtensionPrefs({
      arbAllowedPlatforms: ["PB", "Nope", "RAY", "PB"],
    }).arbAllowedPlatforms).toEqual(["PB", "RAY"]);
  });

  it("treats null/empty arb allowlist as all chips on", () => {
    expect(isArbAllowedPlatformOn(null, "PB")).toBe(true);
    expect(isArbAllowedPlatformOn([], "PB")).toBe(true);
    expect(isArbAllowedPlatformOn(["PB"], "PB")).toBe(true);
    expect(isArbAllowedPlatformOn(["PB"], "RAY")).toBe(false);
  });

  it("toggles arb chips: all-on is null; keeps at least one visible venue", () => {
    const all = ["OB", "RAY", "PB"] as const;
    expect(toggleArbAllowedPlatform(null, "OB", all)).toEqual(["RAY", "PB"]);
    expect(toggleArbAllowedPlatform(["OB", "RAY", "PB"], "OB", all)).toEqual(["RAY", "PB"]);
    expect(toggleArbAllowedPlatform(["RAY", "PB"], "OB", all)).toBeNull();
    expect(toggleArbAllowedPlatform(["PB"], "PB", all)).toEqual(["PB"]);
    expect(toggleArbAllowedPlatform(["PB", "IM"], "PB", all)).toEqual(["PB", "IM"]);
  });
});
