import { expect, it } from "vitest";
import { transformPmPrice } from "@changmen/venue-browser/polymarket/priceQuote";
import { pmFeeAdjustedOdds, pmFeeDisplayPrice } from "./pmFeeOddsDisplay";

const fee = { feeRate: .05, exponent: 1, takerOnly: true };
it.each([[.8, "1.237"], [.5, "1.951"], [.2, "4.807"]] as const)("folds taker cost into odds at price %s", (price, expected) => {
  expect(pmFeeAdjustedOdds(price, fee)).toBe(expected);
});
it("distinguishes a proven zero fee from unknown fees or unsupported curves", () => {
  expect(pmFeeAdjustedOdds(.5, { ...fee, feeRate: 0 })).toBe("2.000");
  expect(pmFeeAdjustedOdds(.5, undefined)).toBeUndefined();
  expect(pmFeeAdjustedOdds(.5, { ...fee, exponent: 2 })).toBeUndefined();
  for (const price of [undefined, 0, 1, NaN, Infinity]) expect(pmFeeAdjustedOdds(price, fee)).toBeUndefined();
});
it.each([
  { enabled: false, multiplier: 1.01 },
  { enabled: true, mode: "percent" as const, multiplier: 1.03 },
  { enabled: true, mode: "tick" as const, multiplier: 1.01 },
])("uses the exact displayed quote price without changing the quote: %j", policy => {
  const quote = transformPmPrice("token", .53, policy, "0.01");
  if (quote.status !== "ready") throw Error("fixture quote unavailable");
  const before = JSON.stringify(quote);
  const price = pmFeeDisplayPrice(quote.quote.displayOdds, quote);
  expect(price).toBe(quote.quote.cap);
  expect(pmFeeAdjustedOdds(price, fee)).toBeDefined();
  expect(pmFeeDisplayPrice(quote.quote.displayOdds + .01, quote)).toBeUndefined();
  expect(JSON.stringify(quote)).toBe(before);
});
it("retains source precision for fallback odds and never bypasses a locked quote", () => {
  expect(pmFeeDisplayPrice(1.886, undefined, 1 / .53)).toBeCloseTo(.53, 14);
  expect(pmFeeDisplayPrice(1.886, { status: "locked" }, 1 / .53)).toBeUndefined();
  expect(pmFeeDisplayPrice(0, undefined, 2)).toBeUndefined();
  expect(pmFeeDisplayPrice(1.886, undefined, 2)).toBeUndefined();
});
