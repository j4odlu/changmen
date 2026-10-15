import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { expect, it } from "vitest";
import { prepareLocalGtcPlan } from "./localPlan";
const plan = { playerId: 1, otherPlayerId: 2, originalPmLeg: "A", otherProvider: "RAY", otherTarget: "Away", otherOdds: 2, otherStake: 10, target: "Home", protocol: 2, orderHash: `0x${"b".repeat(64)}`, price: "0.5", shares: "10", targetShares: "10", maxPrincipal: "5", allInBudget: "5", fx: 6.7, parallel: false, negRisk: false } as GtcPlan;
it("retains original plan admission and excludes credentials from the client journal", () => {
  const incoming = { ...plan, privateKey: "secret", token: "secret" };
  const saved = prepareLocalGtcPlan(incoming);
  expect(saved).toMatchObject(plan); expect(saved).not.toHaveProperty("token"); expect(saved).not.toHaveProperty("privateKey");
});
it.each([
  { source: "invalid" }, { playerId: 0 }, { otherPlayerId: -1 }, { orderHash: "bad" }, { protocol: 1 },
  { shares: "11" }, { price: "1" }, { shares: "0" }, { fx: Infinity }, { otherOdds: 1 }, { otherStake: 0 },
  { maxPrincipal: "6" }, { parallel: "false" }, { negRisk: null },
])("rejects the same invalid frozen plan before reservation: %o", patch => {
  expect(() => prepareLocalGtcPlan({ ...plan, ...patch } as GtcPlan)).toThrow();
});
it("manual plans require only PM and cannot conceal a second leg", () => {
  expect(() => prepareLocalGtcPlan({ ...plan, source: "manual" })).toThrow("不能包含第二腿");
  const manual = { ...plan, source: "manual" as const, otherPlayerId: 0, otherProvider: "", otherOdds: 0, otherStake: 0 };
  expect(prepareLocalGtcPlan(manual)).toMatchObject(manual);
});
it.each([undefined, { rate: "0" }, { rate: "0.05", exponent: 2, takerOnly: true, observedAt: 1 }])("missing fee proof does not introduce a new submission gate: %o", feeProof => {
  expect(prepareLocalGtcPlan({ ...plan, feeProof } as GtcPlan)).not.toHaveProperty("feeProof");
});
