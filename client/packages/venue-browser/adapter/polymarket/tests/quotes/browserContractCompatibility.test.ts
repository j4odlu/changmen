import { expect, it } from "vitest";
import { isValidClobPrice as preflightValid } from "@changmen/venue-browser/polymarket/submission/preflight/pmDetection";
import { isValidClobPrice as canonicalValid } from "../../../../polymarket/pmPriceValidity";
import { PolymarketPriceAboveDetectionError as QuoteError, isPolymarketPriceAboveDetectionError as quoteCheck } from "@changmen/venue-browser/polymarket/quotes/pmTokenQuote";
import { PolymarketPriceAboveDetectionError as PublicError } from "@changmen/venue-browser/polymarket/pmPriceError";
import { PolymarketPriceAboveDetectionError as CanonicalError, isPolymarketPriceAboveDetectionError as canonicalCheck } from "../../../../polymarket/pmPriceError";
import * as publicTicks from "@changmen/venue-browser/polymarket/pmTickPrice";
import * as canonicalTicks from "../../../../polymarket/pmTickPrice";
import { pmBuyOrderShares as publicShares } from "@changmen/venue-browser/polymarket/pmBuyOrderShares";
import { pmBuyOrderShares as canonicalShares } from "../../../../polymarket/pmBuyOrderShares";
import { polymarketMarketOrderOptions as publicOptions } from "@changmen/venue-browser/polymarket/pmMarketOrderOptions";
import { polymarketMarketOrderOptions as canonicalOptions } from "../../../../polymarket/pmMarketOrderOptions";
import { transformPmPrice, validatePmPriceQuote } from "@changmen/venue-browser/polymarket/priceQuote";
import * as policy from "@changmen/venue-browser/polymarket/quotes/pmArbPriceBufferMode";

it("preflight price predicates retain the canonical implementation and open interval", () => {
  expect(preflightValid).toBe(canonicalValid);
  for (const value of [NaN, Infinity, -Infinity, -1, 0, 1, 2]) expect(canonicalValid(value)).toBe(false);
  for (const value of [Number.MIN_VALUE, 0.5, 1 - Number.EPSILON]) expect(canonicalValid(value)).toBe(true);
});
it("public and quote error entries share the constructor and preserve instanceof", () => {
  expect(PublicError).toBe(CanonicalError);
  expect(QuoteError).toBe(CanonicalError);
  expect(quoteCheck).toBe(canonicalCheck);
  for (const Constructor of [PublicError, QuoteError, CanonicalError]) {
    const error = new Constructor("original message", 0.6, 0.5);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(QuoteError);
    expect(error).toBeInstanceOf(CanonicalError);
    expect(error.name).toBe("PolymarketPriceAboveDetectionError");
    expect(error.message).toBe("original message");
    expect(error.bestAskPrice).toBe(0.6);
    expect(error.detectionMaxPrice).toBe(0.5);
    expect(quoteCheck(error)).toBe(true);
    expect(canonicalCheck(error)).toBe(true);
  }
  expect(canonicalCheck(new Error("same message"))).toBe(false);
  expect(canonicalCheck({ name: "PolymarketPriceAboveDetectionError", bestAskPrice: 0.6, detectionMaxPrice: 0.5 })).toBe(false);
});

it("public tick, share and order-book entries expose their source implementations", () => {
  expect(Object.keys(publicTicks).sort()).toEqual(Object.keys(canonicalTicks).sort());
  for (const name of Object.keys(canonicalTicks) as Array<keyof typeof canonicalTicks>)
    expect(publicTicks[name]).toBe(canonicalTicks[name]);
  expect(publicShares).toBe(canonicalShares);
  expect(publicOptions).toBe(canonicalOptions);
});

it("price policy re-exports the executable quote functions", () => {
  expect(policy.transformPmPrice).toBe(transformPmPrice);
  expect(policy.validatePmPriceQuote).toBe(validatePmPriceQuote);
});
