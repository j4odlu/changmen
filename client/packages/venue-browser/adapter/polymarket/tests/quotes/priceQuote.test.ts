import { expect, it } from "vitest";
import { transformPmPrice, validatePmPriceQuote } from "@changmen/venue-browser/polymarket/priceQuote";
import type { PolymarketTickSize } from "@changmen/venue-browser/polymarket/pmTickPrice";

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
  for (const price of [0, 1, -1, NaN, Infinity])
    expect(transformPmPrice("t", price, { enabled: false, multiplier: 1 })).toEqual({ status: "invalid-price" });
  expect(transformPmPrice("t", 0.5, policy)).toEqual({ status: "waiting-tick" });
  for (const tick of ["unsupported", "0.00001"]) {
    expect(transformPmPrice("t", 0.5, policy, tick as PolymarketTickSize)).toEqual({ status: "invalid-price" });
  }
  expect(transformPmPrice("t", 0.99, policy, "0.01")).toEqual({ status: "invalid-price" });
  expect(transformPmPrice("t", 0.99, { enabled: true, mode: "percent", multiplier: 1.1 }))
    .toMatchObject({ status: "ready", quote: { cap: 0.9999, displayOdds: 1 } });
});

it.each(["none", "percent", "tick"] as const)("frozen %s quotes reject token, price and odds substitutions", mode => {
  const result = transformPmPrice("t", 0.5, {
    enabled: mode !== "none", mode: mode === "tick" ? "tick" : "percent", multiplier: 1.01,
  }, "0.01");
  if (result.status !== "ready") throw new Error("missing quote");
  const quote = result.quote;
  const expected = mode === "none" ? [0.5, 2] : mode === "percent" ? [0.505, 1.980] : [0.51, 1.960];
  expect([quote.cap, quote.displayOdds]).toEqual(expected);
  expect(Object.isFrozen(quote)).toBe(true);
  expect(validatePmPriceQuote(quote, "t", quote.displayOdds)).toBe(quote);
  expect(() => validatePmPriceQuote({ ...quote, cap: 0.6 }, "t", quote.displayOdds))
    .toThrow("PM 调整报价缺失或不匹配，请新建投注尝试");
  expect(() => validatePmPriceQuote(quote, "other", quote.displayOdds)).toThrow();
  if (mode !== "none")
    expect(() => validatePmPriceQuote({ ...quote, cap: 1 / quote.displayOdds }, "t", quote.displayOdds)).toThrow();
  expect(() => validatePmPriceQuote(quote, "t", mode === "none" ? 3 : 2)).toThrow();
});
