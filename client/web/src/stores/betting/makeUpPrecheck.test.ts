import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import type { MakeUpPrecheckInput } from "./makeUpPrecheck";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { legStakeCny } from "@/domain/polymarket/pmArbStake";
import { checkMakeupProfitRateCandidate, isMakeupProfitRateMode } from "@/extensions/arbBet/makeupOddsBand";
import { PlatformAccount } from "@/models/platformAccount";
import { passesMakeUpPrecheck } from "./makeUpPrecheck";

const band: MakeupOddsBandPrefs = { enabled: true, upper: 1.02, lower: 0.96, mode: "profitRate", upperProfitPct: 4, lowerLossPct: 3 };

function input(patch: Partial<MakeUpPrecheckInput> = {}): MakeUpPrecheckInput {
  return {
    order: { betMoney: 100, betOdds: 2 },
    checked: { odds: 2, betMoney: 100, type: "OB" },
    account: new PlatformAccount({ accountId: 1, provider: "OB", currency: "CNY" }),
    sideOdds: 2.4, useBand: true, bandPrefs: band, ...patch,
  };
}

describe("passesMakeUpPrecheck", () => {
  it("blocks a quote moved into the band by precheck and uses checked odds rather than newOdds", () => {
    const checked = { odds: 2, newOdds: 2.4, betMoney: 100, type: "OB" as const };
    expect(passesMakeUpPrecheck(input({ checked }))).toBe(false);
  });

  it.each([1.8, 2.2])("retains the existing permission outside the band at %s", (odds) => {
    expect(passesMakeUpPrecheck(input({ order: { betMoney: 100, betOdds: odds }, checked: { type: "OB", odds, betMoney: 100 } }))).toBe(true);
  });

  it.each([1.94, 2.08])("blocks the exact profit or loss boundary at %s", (odds) => {
    expect(passesMakeUpPrecheck(input({ order: { betMoney: 100, betOdds: odds }, checked: { type: "OB", odds, betMoney: 100 } }))).toBe(false);
  });

  it.each([0, Number.NaN])("retains the side-odds fallback for checked odds %s", (odds) => {
    expect(passesMakeUpPrecheck(input({ sideOdds: 2, checked: { type: "OB", odds, betMoney: 100 } }))).toBe(false);
    expect(passesMakeUpPrecheck(input({ sideOdds: 1.8, checked: { type: "OB", odds, betMoney: 100 } }))).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("blocks invalid checked stake %s", (betMoney) => {
    expect(passesMakeUpPrecheck(input({ checked: { type: "OB", odds: 2, betMoney } }))).toBe(false);
  });

  it("uses the same PM-only stake conversion and keeps the existing PF handling", () => {
    const account = new PlatformAccount({ accountId: 1, provider: "Polymarket", currency: "USDT" });
    expect(legStakeCny(15, "Polymarket", account)).toBe(100.5);
    expect(passesMakeUpPrecheck(input({ order: { betMoney: 100.5, betOdds: 2 }, checked: { type: "Polymarket", odds: 2, betMoney: 15 }, account }))).toBe(false);
    const pfAccount = new PlatformAccount({ accountId: 2, provider: "PredictFun", currency: "USDT" });
    expect(passesMakeUpPrecheck(input({ order: { betMoney: 100.5, betOdds: 2 }, checked: { type: "PredictFun", odds: 2, betMoney: 15 }, account: pfAccount }))).toBe(true);
  });

  it.each([
    { useBand: false },
    { bandPrefs: undefined },
    { bandPrefs: null },
    { bandPrefs: { ...band, mode: "oddsFactor" as const } },
  ])("bypasses without reading checked stake or odds for %j", (patch) => {
    const checked = Object.freeze({ type: "OB" as const,
      get odds(): number { throw new Error("unexpected checked odds read"); },
      get betMoney(): number { throw new Error("unexpected checked stake read"); },
    });
    expect(passesMakeUpPrecheck(input({ checked, ...patch }))).toBe(true);
  });

  it("matches the original gate and property-read order for 12096 frozen-input scenarios", () => {
    const entry = JSON.parse(readFileSync(new URL("../../../../../scripts/verification/makeup-precheck-extraction.json", import.meta.url), "utf8"));
    const legacy = runInNewContext(`(function ({ order, checked, account, sideOdds, useBand, bandPrefs }) { ${entry.changes[1][1].replace("continue;", "return false;")} return true; })`,
      { legStakeCny, checkMakeupProfitRateCandidate, isMakeupProfitRateMode }) as typeof passesMakeUpPrecheck;
    const prefs = [undefined, null, band, { ...band, enabled: false }, { ...band, mode: "oddsFactor" as const }, { ...band, upperProfitPct: 0, lowerLossPct: 0 }];
    let count = 0;
    for (const useBand of [false, true]) for (const bandPrefs of prefs)
      for (const filledOdds of [1, 2, 2.4]) for (const filledStake of [0, 100])
        for (const odds of [0, Number.NaN, Number.POSITIVE_INFINITY, 1, 1.8, 2, 2.4])
          for (const stake of [0, 15, 100, Number.NaN]) for (const type of ["OB", "Polymarket", "PredictFun"] as const)
            for (const sideOdds of [1.8, 2]) {
              const trace: string[] = [];
              const account = new PlatformAccount({ accountId: 1, provider: type, currency: "USDT" });
              const frozen = Object.freeze(input({ useBand, bandPrefs, sideOdds, account,
                order: Object.freeze({
                  get betMoney() { trace.push("filledStake"); return filledStake; },
                  get betOdds() { trace.push("filledOdds"); return filledOdds; },
                }),
                checked: Object.freeze({
                  get odds() { trace.push("checkedOdds"); return odds; },
                  get betMoney() { trace.push("checkedStake"); return stake; },
                  get type() { trace.push("checkedType"); return type; },
                }),
              }));
              const expected = legacy(frozen);
              const expectedTrace = trace.splice(0);
              expect(passesMakeUpPrecheck(frozen)).toBe(expected);
              expect(trace).toEqual(expectedTrace);
              count++;
            }
    expect(count).toBe(12096);
  });
});
