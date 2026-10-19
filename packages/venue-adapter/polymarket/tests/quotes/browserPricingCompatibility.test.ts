import { expect, it } from "vitest";
import * as canonical from "@changmen/venue-browser/polymarket/priceQuote";
import * as legacy from "../../priceQuote";
import * as nested from "../../quotes/priceQuote";
import * as policy from "../../pmArbPriceBufferMode";

it("new, nested and public pricing entries expose the same functions", () => {
  for (const entry of [legacy, nested, policy]) {
    expect(entry.transformPmPrice).toBe(canonical.transformPmPrice);
    expect(entry.validatePmPriceQuote).toBe(canonical.validatePmPriceQuote);
  }
});

it.each(["none", "percent", "tick"] as const)("%s quotes cross old/new validation without copying or changing rounding", mode => {
  const result = canonical.transformPmPrice("token", 0.5, {
    enabled: mode !== "none", mode: mode === "tick" ? "tick" : "percent", multiplier: 1.01,
  }, "0.01");
  if (result.status !== "ready") throw new Error("missing quote");
  const expected = mode === "none" ? [0.5, 2] : mode === "percent" ? [0.505, 1.980] : [0.51, 1.960];
  expect([result.quote.cap, result.quote.displayOdds]).toEqual(expected);
  expect(Object.isFrozen(result.quote)).toBe(true);
  expect(legacy.validatePmPriceQuote(result.quote, "token", result.quote.displayOdds)).toBe(result.quote);
  expect(() => canonical.validatePmPriceQuote({ ...result.quote, cap: 0.6 }, "token", result.quote.displayOdds))
    .toThrow("PM 调整报价缺失或不匹配，请新建投注尝试");
});

it("preserves invalid input, missing tick and capped percentage boundary behavior", () => {
  for (const price of [0, 1, -1, NaN, Infinity])
    expect(canonical.transformPmPrice("t", price, { enabled: false, multiplier: 1 })).toEqual({ status: "invalid-price" });
  expect(canonical.transformPmPrice("t", 0.5, { enabled: true, mode: "tick", multiplier: 1.01 }))
    .toEqual({ status: "waiting-tick" });
  expect(canonical.transformPmPrice("t", 0.99, { enabled: true, mode: "percent", multiplier: 1.1 }))
    .toMatchObject({ status: "ready", quote: { cap: 0.9999, displayOdds: 1 } });
});
