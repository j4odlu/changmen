import { expect, it } from "vitest";
import { mergePolymarketProviderSave } from "./save_pm.js";
const snapshot = { orderId: "original", accountId: 317, makerAmount: "14930000", stakeUsdc: 14.93, submittedAt: 1790697330729 };
it("restores reject principal and repeated stale sync cannot inflate it or add fees", () => {
  const old = { betMoney: 790.6, pmStakeUsdc: 118, pmOrigin: "changmen" };
  const incoming = { orderId: "original", status: "reject", pmSubmission: snapshot };
  const fixed = mergePolymarketProviderSave({ order_id: "original" }, old, incoming, "changmen", { ...old, ...incoming }, 0, 790.6);
  expect(fixed.bet_money).toBeCloseTo(100.031);
  const synced = mergePolymarketProviderSave({ order_id: "original" }, fixed.raw,
    { orderId: "original", status: "reject", betMoney: 790.6, pmStakeUsdc: 118 }, "changmen", fixed.raw, 0, 790.6);
  expect(synced.bet_money).toBeCloseTo(100.031);
  expect(synced.raw.pmStakeUsdc).toBe(14.93);
  expect(synced.raw.reward).toBe(0);
});
it("real fill keeps the actual all-in cost", () => {
  const prev = {};
  const incoming = { orderId: "original", status: "none", betMoney: 101, pmStakeUsdc: 101 / 6.7,
    pmShares: 30, pmFeeUsdc: 0.1, pmFillPrice: 0.5 };
  const actual = mergePolymarketProviderSave({}, prev, incoming, "changmen", { ...prev, ...incoming }, 0, 101);
  expect(actual.bet_money).toBe(101);
  expect(actual.raw.pmFeeUsdc).toBe(0.1);
});
