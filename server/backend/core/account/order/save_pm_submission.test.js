import { expect, it } from "vitest";
import { mergePolymarketProviderSave } from "./save_pm.js";
import { rowToOrder } from "./dto.js";
import { pmSubmissionFromResult, validatePmSubmission } from "@changmen/shared/pm_submission";
import { preparePmPendingOrderSave } from "./pm_pending.js";
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

it("keeps signed quantities as optional display evidence through reject saves and stale sync", () => {
  const original = pmSubmissionFromResult({ orderId: "original", beginTime: snapshot.submittedAt,
    request: { order: { side: "BUY", makerAmount: "14930000", takerAmount: "29860000", signature: "do-not-store" } } }, 317);
  expect(original).toEqual({ ...snapshot, takerAmount: "29860000" });
  expect(validatePmSubmission(original, "original", 317)).toEqual(original);
  const incoming = { orderId: "original", status: "reject", pmSubmission: original };
  const saved = mergePolymarketProviderSave({}, {}, incoming, "changmen", incoming, 0, 0);
  const synced = mergePolymarketProviderSave({ order_id: "original" }, saved.raw,
    { orderId: "original", status: "reject" }, "changmen", saved.raw, 0, saved.bet_money);
  const dto = rowToOrder({ order_id: "original", player_id: 317, provider: "Polymarket", status: "Reject", raw: synced.raw });
  expect(dto.PmSubmittedPrice).toBeUndefined();
  expect(dto.PmFillPrice).toBeUndefined();
  expect(dto.PmShares).toBeUndefined();
  expect(dto.pmSubmission).toBeUndefined();
  expect(synced.bet_money).toBeCloseTo(14.93 * 6.7);
  const known = { ...synced.raw, pmOrderPrice: 0.51 };
  const refreshed = mergePolymarketProviderSave({ order_id: "original" }, known,
    { orderId: "original", status: "reject" }, "changmen", {}, 0, synced.bet_money);
  expect(rowToOrder({ provider: "Polymarket", raw: refreshed.raw }).PmSubmittedPrice).toBe(0.51);
});

it("accepts old submission snapshots and never derives a price from mismatched or malformed evidence", () => {
  expect(validatePmSubmission(snapshot, "original", 317)).toEqual(snapshot);
  const row = { order_id: "original", player_id: 317, provider: "Polymarket", status: "Reject" };
  for (const value of [snapshot, { ...snapshot, takerAmount: "0" }, { ...snapshot, takerAmount: "NaN" },
    { ...snapshot, takerAmount: "1000000" }, { ...snapshot, orderId: "another", takerAmount: "29860000" },
    { ...snapshot, accountId: 318, takerAmount: "29860000" }])
    expect(rowToOrder({ ...row, raw: { pmSubmission: value } }).PmSubmittedPrice).toBeUndefined();
  const raw = { pmSubmission: { ...snapshot, takerAmount: "29860000" } };
  for (const status of ["None", "Win", "Lose", "Return"])
    expect(rowToOrder({ ...row, status, raw }).PmSubmittedPrice).toBeUndefined();
  expect(rowToOrder({ ...row, raw: { ...raw, pmSide: "sell" } }).PmSubmittedPrice).toBeUndefined();
  expect(rowToOrder({ ...row, raw: { ...raw, pmGtcExecutionId: "gtc" } }).PmSubmittedPrice).toBeUndefined();
  expect(rowToOrder({ ...row, provider: "RAY", raw }).PmSubmittedPrice).toBeUndefined();
});

it("reads the official order price independently of signed quantities, precheck odds and fills", () => {
  const submission = { ...snapshot, makerAmount: "5100000", takerAmount: "10000000", stakeUsdc: 5.1 };
  const filled = { orderId: "original", provider: "Polymarket", status: "none", odds: 2, pmSide: "buy",
    pmOrderPrice: 0.52, pmSubmission: submission, pmShares: 10, pmFillPrice: 0.5044, pmStakeUsdc: 5.044, betMoney: 33.7948 };
  const row = { order_id: "original", player_id: 317, provider: "Polymarket", status: "None", odds: 2, raw: filled };
  const synced = preparePmPendingOrderSave(row, { orderId: "original", status: "lose", odds: 1.982,
    pmFillPrice: 0.5044, pmShares: 10 }, 317, "Polymarket");
  const dto = rowToOrder({ ...row, status: "Lose", raw: synced });
  expect(dto.PmSubmittedPrice).toBe(0.52);
  expect(dto.PmFillPrice).toBe(0.5044);
  expect(dto.Odds).toBe(2);
  expect(synced.pmSubmission).toEqual(submission);
  expect(dto.pmSubmission).toBeUndefined();
});

it("preserves an official price on ordinary fill saves without any submission snapshot", () => {
  const incoming = { orderId: "original", provider: "Polymarket", status: "none", pmSide: "buy",
    pmOrderPrice: 0.51, pmShares: 10, pmFillPrice: 0.5044, pmStakeUsdc: 5.044, betMoney: 33.7948 };
  const saved = mergePolymarketProviderSave({}, {}, incoming, "changmen", { ...incoming }, 0, incoming.betMoney);
  const base = { order_id: "original", player_id: 317, provider: "Polymarket", raw: saved.raw };
  for (const status of ["None", "Win", "Lose", "Reject", "Pending"])
    expect(rowToOrder({ ...base, status }).PmSubmittedPrice).toBe(0.51);
  expect(saved.raw.pmSubmission).toBeUndefined();
  const stale = { ...incoming, pmOrderPrice: undefined };
  const synced = mergePolymarketProviderSave({}, saved.raw, stale, "changmen", { ...stale }, 0, stale.betMoney);
  expect(synced.raw.pmOrderPrice).toBe(0.51);
  expect(rowToOrder({ ...base, raw: { ...saved.raw, pmSide: "sell" } }).PmSubmittedPrice).toBeUndefined();
  for (const pmOrderPrice of [undefined, 0, 1, -1, "bad", Infinity])
    expect(rowToOrder({ ...base, raw: { ...saved.raw, pmOrderPrice } }).PmSubmittedPrice).toBeUndefined();
});
