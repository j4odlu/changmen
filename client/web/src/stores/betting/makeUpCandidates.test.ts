import type { BetSide } from "@/models/match";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { filterMakeupOddsBandCandidates, isMakeupOddsBandEnabled } from "@/extensions/arbBet/makeupOddsBand";
import { LoseOrder } from "@/models/loseOrder";
import { selectMakeUpCandidates } from "./makeUpCandidates";

const band: MakeupOddsBandPrefs = { enabled: true, upper: 1.02, lower: 0.96 };
const profitBand: MakeupOddsBandPrefs = { ...band, mode: "profitRate", upperProfitPct: 4, lowerLossPct: 3 };

function item(id: string, home: number, away = home) {
  return Object.freeze({ id, getOdds: (target: BetSide) => target === "Home" ? home : away });
}

function select(quotes: number[], prefs?: MakeupOddsBandPrefs | null, patch: Partial<ConstructorParameters<typeof LoseOrder>[0]> = {}) {
  const order = Object.freeze(new LoseOrder({ target: "Home", betMoney: 100, betOdds: 2, ...patch }));
  const items = Object.freeze(quotes.map((odds, index) => item(String(index), odds)));
  const result = selectMakeUpCandidates({ order, bet: { items }, config: { makeProfit: 1 }, bandPrefs: prefs });
  return { ...result, order, items };
}

describe("selectMakeUpCandidates", () => {
  it("includes the floor and keeps equal-price source order without mutating inputs", () => {
    const result = select([1.9, 2.3, 2, 2.3]);
    expect(result.useBand).toBe(false);
    expect(result.candidates).toEqual([result.items[1], result.items[3], result.items[2]]);
    expect(result.candidates[0]).toBe(result.items[1]);
    expect(result.items.map(candidate => candidate.id)).toEqual(["0", "1", "2", "3"]);
  });

  it("uses the requested side", () => {
    const items = Object.freeze([item("A", 5, 2), item("B", 1.5, 3)]);
    const order = Object.freeze(new LoseOrder({ target: "Away", betMoney: 100, betOdds: 2 }));
    expect(selectMakeUpCandidates({ order, bet: { items }, config: { makeProfit: 1 } }).candidates)
      .toEqual([items[1], items[0]]);
  });

  it.each([1.92, 2, 2.04])("stops at in-band best odds %s without falling through", (best) => {
    const result = select([1.8, best], band);
    expect(result).toMatchObject({ useBand: true, candidates: [] });
  });

  it("keeps only quotes above the upper bound and preserves equal-price order", () => {
    const result = select([2.04, 2.2, 2.1, 1.8, 2.2], band);
    expect(result.candidates).toEqual([result.items[1], result.items[4], result.items[2]]);
  });

  it("keeps all quotes in descending order when the best is below the lower bound", () => {
    const result = select([1.6, 1.8, 1.7], band);
    expect(result.candidates).toEqual([result.items[1], result.items[2], result.items[0]]);
  });

  it("honors a disabled lower bound", () => {
    expect(select([1.8, 1.7], { ...band, lower: 0 }).candidates).toEqual([]);
  });

  it("falls back only on null while retaining enabled-band metadata for precheck", () => {
    const order = new LoseOrder({ target: "Home", betMoney: 100, betOdds: 1 });
    order.getOdds = vi.fn(() => 2);
    const items = Object.freeze([item("A", 1.8), item("B", 2), item("C", 2.4)]);
    const result = selectMakeUpCandidates({ order: Object.freeze(order), bet: { items }, config: { makeProfit: 1.01 }, bandPrefs: band });
    expect(result).toEqual({ useBand: true, candidates: [items[2], items[1]] });
    expect(order.getOdds).toHaveBeenCalledExactlyOnceWith(1.01);
  });

  it.each([band, profitBand])("manual tasks use the fixed floor and bypass $mode bands", (prefs) => {
    const result = select([2.05, 2.2, 2.1], prefs, { isCreateOrder: true, betOdds: 2.1 });
    expect(result).toMatchObject({ useBand: false, candidates: [result.items[1], result.items[2]] });
  });

  it("applies the existing plan-amount profit band", () => {
    expect(select([2.05, 1.8], profitBand).candidates).toEqual([]);
    const high = select([2.05, 2.3, 2.2, 1.8], profitBand);
    expect(high.candidates).toEqual([high.items[1], high.items[2]]);
    const low = select([1.7, 1.8], profitBand);
    expect(low.candidates).toEqual([low.items[1], low.items[0]]);
  });

  it.each([undefined, null, { ...band, enabled: false }, band, profitBand])("supports an empty source list with preferences %j", (prefs) => {
    expect(select([], prefs).candidates).toEqual([]);
  });

  it("matches the original selection, method call order and references for 7680 frozen-input scenarios", () => {
    const entry = JSON.parse(readFileSync(new URL("../../../../../scripts/verification/makeup-candidates-extraction.json", import.meta.url), "utf8"));
    const legacy = runInNewContext(`(function ({ order, bet, config, bandPrefs }) { ${entry.changes[2][1]} return { useBand, candidates }; })`,
      { filterMakeupOddsBandCandidates, isMakeupOddsBandEnabled }) as typeof selectMakeUpCandidates;
    const prefs: (MakeupOddsBandPrefs | null | undefined)[] = [undefined, null, { ...band, enabled: false }, band,
      { ...band, lower: 0 }, profitBand, { ...band, lower: 1.2 }, { ...profitBand, upperProfitPct: 0, lowerLossPct: 0 }];
    const quoteSets = [[], [1.8, 2, 2.3], [2.04, 2.04], [Number.NaN, 0, Number.POSITIVE_INFINITY], [1.92, 2.04], [2.3, 2.3, 2.2, 1.8]];
    let count = 0;
    for (const target of ["Home", "Away"] as const) for (const manual of [false, true])
      for (const filledOdds of [0, 1, 1.85, 2, 3.5]) for (const makeProfit of [0, 1, 1.01, 1.1])
        for (const bandPrefs of prefs) for (const quotes of quoteSets) for (const stake of [0, 100]) {
          const trace: unknown[] = [];
          const reference = new LoseOrder({ target, isCreateOrder: manual, betOdds: filledOdds, betMoney: stake });
          const order = Object.freeze({ target, isCreateOrder: manual, betOdds: filledOdds, betMoney: stake,
            getOdds: (profit: number) => { trace.push(["floor", profit]); return reference.getOdds(profit); },
            getBetMoney: (odds: number) => { trace.push(["stake", odds]); return reference.getBetMoney(odds); },
          });
          const items = Object.freeze(quotes.map((odds, index) => Object.freeze({ id: index,
            getOdds: (side: BetSide) => { trace.push(["quote", index, side]); return side === "Home" ? odds : odds + 0.125; },
          })));
          const input = { order, bet: { items }, config: { makeProfit }, bandPrefs };
          const expected = legacy(input);
          const expectedTrace = trace.splice(0);
          const actual = selectMakeUpCandidates(input);
          expect(actual.useBand).toBe(expected.useBand);
          expect(actual.candidates).toEqual(expected.candidates);
          actual.candidates.forEach((candidate, index) => expect(candidate).toBe(expected.candidates[index]));
          expect(trace).toEqual(expectedTrace);
          expect(items.map(candidate => candidate.id)).toEqual(quotes.map((_odds, index) => index));
          count++;
        }
    expect(count).toBe(7680);
  });
});
