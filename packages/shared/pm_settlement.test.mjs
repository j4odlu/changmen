import { expect, test } from "vitest";
import { polymarketEqualSplitResolved, polymarketNeedsFinalResolution, polymarketWithFinalResolution, polymarketEqualSplitAmounts, polymarketFinalPayout, polymarketVerifiedOrderPayout } from "./pm_settlement.js";

const condition = "0x" + "a".repeat(64);
const resolution = { condition_id: condition, status: "resolved", payouts: [500000, 500000] };
for (const version of ["v1", "v2"]) {
  const market = { version, conditionId: condition, closed: true, outcomePrices: '["0.5","0.5"]',
    ...(version === "v2" ? { positionIds: ["201", "202"], clobTokenIds: '["101","102"]' } : { clobTokenIds: '["101","102"]' }) };
  test(`${version}: only a uniquely matched final payout proves a split`, () => {
    expect(polymarketEqualSplitResolved(market)).toBe(false);
    expect(polymarketNeedsFinalResolution(market)).toBe(true);
    expect(polymarketEqualSplitResolved(polymarketWithFinalResolution(market, [resolution]))).toBe(true);
    for (const rows of [[], [resolution, resolution], [{ ...resolution, condition_id: "other" }],
      [{ ...resolution, status: "disputed" }], [{ ...resolution, payouts: ["500000", "500000"] }],
      [{ ...resolution, payouts: [500000] }], [{ ...resolution, payouts: [1, 1] }]]) {
      expect(polymarketWithFinalResolution(market, rows)).toBe(market);
    }
    expect(polymarketEqualSplitResolved({ ...market, condition_id: "wrong", finalResolution: resolution })).toBe(false);
    expect(polymarketEqualSplitResolved({ ...market, version: "future", finalResolution: resolution })).toBe(false);
    expect(polymarketNeedsFinalResolution({ ...market, closed: false })).toBe(false);
  });
  test(`${version}: final receipts use official payouts and remain bound to the held asset`, () => {
    const assetId = version === "v2" ? "201" : "101";
    const receipt = polymarketFinalPayout({ ...market, finalResolution: resolution }, assetId);
    const order = { pmConditionId: condition, pmTokenId: assetId, pmMatchResult: "equal_split", pmSettlement: receipt };
    expect(polymarketVerifiedOrderPayout(order)).toBe(0.5);
    for (const patch of [{ pmTokenId: "other" }, { pmConditionId: "other" }, { pmMatchResult: "win" },
      { pmSettlement: { ...receipt, price: "0.5" } }, { pmSettlement: { ...receipt, source: "price" } }])
      expect(polymarketVerifiedOrderPayout({ ...order, ...patch })).toBeUndefined();
    expect(polymarketFinalPayout(market, assetId)).toBeUndefined();
    expect(polymarketFinalPayout({ ...market, finalResolution: resolution }, "other")).toBeUndefined();
  });
}
test.each([[100, 40, 0, 50, 10, "win"], [100, 60, 0, 50, -10, "lose"],
  [100, 50, 0, 50, 0, "return"], [100, 50.1, 0, 50, -.1, "lose"],
  [60, 24, -4, 30, 2, "win"]])("payout %j shares with cost %j and realized %j", (shares, cost, realized, reward, money, status) => {
  expect(polymarketEqualSplitAmounts(shares, cost, realized)).toEqual({ reward, money, status });
});
test("unknown cost or realized proceeds must not silently become zero", () => {
  for (const values of [[100, NaN, 0], [100, undefined, 0], [100, 40, null], [100, 40, Infinity], [-1, 1, 0], [1, -1, 0]]) {
    expect(polymarketEqualSplitAmounts(...values)).toBeNull();
  }
});
