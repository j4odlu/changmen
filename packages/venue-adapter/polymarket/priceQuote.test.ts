import { expect, it } from "vitest";
import { transformPmPrice, validatePmPriceQuote } from "./priceQuote";
import type { PolymarketTickSize } from "./pmTickPrice";

it("percentage and tick rules convert one raw price without stacking or mutating inputs", () => {
  const policy = { enabled: true, mode: "percent" as const, multiplier: 1.01 };
  const percent = transformPmPrice("t", 0.5, policy, "0.01");
  const tick = transformPmPrice("t", 0.5, { ...policy, mode: "tick" }, "0.01");
  expect(percent).toMatchObject({ status: "ready", quote: { rawAsk: 0.5, cap: 0.505, displayOdds: 1.980 } });
  expect(tick).toMatchObject({ status: "ready", quote: { rawAsk: 0.5, cap: 0.51, displayOdds: 1.960 } });
  expect(policy).toEqual({ enabled: true, mode: "percent", multiplier: 1.01 });
  expect(transformPmPrice("t", 0.5, { ...policy, enabled: false })).toMatchObject({ quote: { cap: 0.5, displayOdds: 2 } });
});

it("boundary and malformed metadata cannot produce an executable tick quote", () => {
  const policy = { enabled: true, mode: "tick" as const, multiplier: 1.01 };
  expect(transformPmPrice("t", 0.5, policy)).toEqual({ status: "waiting-tick" });
  for (const tick of ["unsupported", "0.00001"]) {
    expect(transformPmPrice("t", 0.5, policy, tick as PolymarketTickSize)).toEqual({ status: "invalid-price" });
  }
  expect(transformPmPrice("t", 0.99, policy, "0.01")).toEqual({ status: "invalid-price" });
});

it.each(["percent", "tick"] as const)("frozen %s quotes reject token, price and odds substitutions", mode => {
  const result = transformPmPrice("t", 0.5, { enabled: true, mode, multiplier: 1.01 }, "0.01");
  if (result.status !== "ready") throw new Error("missing quote");
  const quote = result.quote;
  expect(Object.isFrozen(quote)).toBe(true);
  expect(validatePmPriceQuote(quote, "t", quote.displayOdds)).toBe(quote);
  expect(() => validatePmPriceQuote(quote, "other", quote.displayOdds)).toThrow();
  expect(() => validatePmPriceQuote({ ...quote, cap: 1 / quote.displayOdds }, "t", quote.displayOdds)).toThrow();
  expect(() => validatePmPriceQuote(quote, "t", 2)).toThrow();
});
