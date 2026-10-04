import { describe, expect, it } from "vitest";
import { evaluatePodOutcomeGate, podOutcomeGateEntryFrom, podOutcomeExecutionScope } from "@/runtime/podYabo/gate";

describe("podYabo/gate", () => {
  it("shares the execution scope across directions but separates halves and preserves moneyline", () => {
    const entry = { obMid: "m1", marketCode: "totals", boardSide: "over" as const };
    expect(podOutcomeExecutionScope(entry)).toBe(podOutcomeExecutionScope({ ...entry, boardSide: "under" }));
    expect(podOutcomeExecutionScope({ ...entry, marketCode: "ht_totals" })).not.toBe(podOutcomeExecutionScope(entry));
    expect(podOutcomeExecutionScope({ ...entry, marketCode: "moneyline" })).toBe("");
  });
  it("blocks same-side totals add and opposite-side hedge on one mid", () => {
    const placed = [{ obMid: "m1", marketCode: "totals", boardSide: "over" as const }];
    expect(evaluatePodOutcomeGate({
      obMid: "m1",
      marketCode: "totals",
      boardSide: "over",
    }, placed)).toMatchObject({ allow: false, decision: "DUPLICATE" });
    expect(evaluatePodOutcomeGate({
      obMid: "m1",
      marketCode: "totals",
      boardSide: "under",
    }, placed)).toMatchObject({ allow: false, decision: "REVERSE" });
    expect(evaluatePodOutcomeGate({
      obMid: "m2",
      marketCode: "totals",
      boardSide: "over",
    }, placed).allow).toBe(true);
  });

  it("blocks same-team spreads and opposite-team hedges, ignores moneyline", () => {
    const placed = [{ obMid: "m1", marketCode: "spreads", boardSide: "home" as const }];
    expect(evaluatePodOutcomeGate({
      obMid: "m1",
      marketCode: "spreads",
      boardSide: "home",
    }, placed).decision).toBe("DUPLICATE");
    expect(evaluatePodOutcomeGate({
      obMid: "m1",
      marketCode: "moneyline",
      boardSide: "home",
    }, placed).allow).toBe(true);
  });

  it("reads marketCode/boardSide off a follow ticket", () => {
    expect(podOutcomeGateEntryFrom({
      obMid: "5652292",
      market: { marketCode: "totals", boardSide: "over" },
    })).toEqual({ obMid: "5652292", marketCode: "totals", boardSide: "over" });
  });
});
