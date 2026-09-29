import { expect, it } from "vitest";
import { planPmSubmissionRepair } from "./repair-pm-submission-amount.mjs";
const orderId = `0x${"9".repeat(64)}`;
const row = { order_id: orderId, player_id: 317, user_id: "u", provider: "Polymarket", status: "Reject", money: 0, raw: {} };
const player = { id: 317, owner_user_id: "u", player_name: "a" };
const logs = [{ title: "[Polymarket](PM,a) 下注 => true", data: { result: {
  provider: "Polymarket", orderId, beginTime: 1000, request: { order: { side: "BUY", makerAmount: "14930000" } },
} } }];
it("uses POST evidence and refuses repairs of filled/foreign/ambiguous rows", () => {
  expect(planPmSubmissionRepair(row, player, logs).betMoney).toBeCloseTo(100.031);
  for (const changed of [{ ...row, status: "None" }, { ...row, user_id: "other" },
    { ...row, raw: { pmShares: 1 } }, { ...row, money: 1 }])
    expect(() => planPmSubmissionRepair(changed, player, logs)).toThrow();
  expect(() => planPmSubmissionRepair(row, player, [])).toThrow();
});
