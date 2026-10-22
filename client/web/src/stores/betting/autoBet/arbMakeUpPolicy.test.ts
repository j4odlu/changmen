import type { ArbMakeUpDecision, ArbMakeUpPolicyInput } from "./arbMakeUpPolicy";
import { BetResult } from "@changmen/client-core/models/betResult";
import { describe, expect, it } from "vitest";
import { decideArbMakeUp } from "./arbMakeUpPolicy";

const filled = Object.freeze(new BetResult("OB", true));
const failed = Object.freeze(new BetResult("RAY", false));
const timeout = Object.freeze(Object.assign(new BetResult("Polymarket", true), { reject: "timeout" }));
const rejected = Object.freeze(Object.assign(new BetResult("Polymarket", true), { reject: "unfilled" }));
const unknown = Object.freeze(Object.assign(new BetResult("Polymarket", false), { pmSubmitUnknown: true }));

function input(overrides: Partial<ArbMakeUpPolicyInput> = {}): ArbMakeUpPolicyInput {
  return { betBothLegs: true, resultA: filled, resultB: filled, rejectA: false, rejectB: false, ...overrides };
}

describe("decideArbMakeUp", () => {
  const cases: [string, Partial<ArbMakeUpPolicyInput>, ArbMakeUpDecision][] = [
    ["both filled", {}, { kind: "none" }],
    ["both failed", { resultA: failed, resultB: failed }, { kind: "none" }],
    ["both absent", { resultA: undefined, resultB: undefined }, { kind: "none" }],
    ["A failed", { resultA: failed }, { kind: "enqueue", side: "A" }],
    ["B failed", { resultB: failed }, { kind: "enqueue", side: "B" }],
    ["A venue rejected", { rejectA: true }, { kind: "enqueue", side: "A" }],
    ["B venue rejected", { rejectB: true }, { kind: "enqueue", side: "B" }],
    ["both venue rejected", { rejectA: true, rejectB: true }, { kind: "none" }],
    ["PM A confirmed unfilled", { resultA: rejected }, { kind: "enqueue", side: "A" }],
    ["PM B confirmed unfilled", { resultB: rejected }, { kind: "enqueue", side: "B" }],
    ["A not attempted in a two-leg plan", { resultA: undefined }, { kind: "enqueue", side: "A" }],
    ["B not attempted in a two-leg plan", { resultB: undefined }, { kind: "enqueue", side: "B" }],
    ["single leg skips absent A", { betBothLegs: false, resultA: undefined }, { kind: "none" }],
    ["single leg skips absent B", { betBothLegs: false, resultB: undefined }, { kind: "none" }],
    ["single leg skips pending receipt", { betBothLegs: false, pendingConfirmA: true }, { kind: "none" }],
    ["A pending with filled B", { pendingConfirmA: true }, { kind: "observe", pendingSide: "A", role: "target" }],
    ["B pending with filled A", { pendingConfirmB: true }, { kind: "observe", pendingSide: "B", role: "target" }],
    ["A pending with failed B", { pendingConfirmA: true, resultB: failed }, { kind: "observe", pendingSide: "A", role: "anchor" }],
    ["B pending with failed A", { pendingConfirmB: true, resultA: failed }, { kind: "observe", pendingSide: "B", role: "anchor" }],
    ["A pending with rejected B", { pendingConfirmA: true, rejectB: true }, { kind: "observe", pendingSide: "A", role: "anchor" }],
    ["B pending with absent A", { pendingConfirmB: true, resultA: undefined }, { kind: "observe", pendingSide: "B", role: "anchor" }],
    ["both pending", { pendingConfirmA: true, pendingConfirmB: true }, { kind: "none" }],
    ["A timeout without confirmed rejection", { resultA: timeout }, { kind: "none" }],
    ["B timeout without confirmed rejection", { resultB: timeout }, { kind: "none" }],
    ["venue rejection overrides timeout", { resultA: timeout, rejectA: true }, { kind: "enqueue", side: "A" }],
    ["A unknown submission", { resultA: unknown }, { kind: "none" }],
    ["B unknown submission", { resultB: unknown }, { kind: "none" }],
    ["pending role retains existing API-success rule", { pendingConfirmA: true, resultB: timeout }, { kind: "observe", pendingSide: "A", role: "target" }],
  ];

  it.each(cases)("%s", (_name, overrides, expected) => {
    const facts = Object.freeze(input(overrides));
    expect(decideArbMakeUp(facts)).toEqual(expected);
  });
});
