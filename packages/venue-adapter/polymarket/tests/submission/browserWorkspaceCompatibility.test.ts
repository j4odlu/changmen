import { expect, test } from "vitest";
import * as publicTick from "@changmen/venue-browser/polymarket/pmTickState";
import * as oldTick from "../../quotes/pmTickState";
import * as publicPrefs from "@changmen/venue-browser/polymarket/pmFokDepthBufferMode";
import * as oldPrefs from "../../fok/pmFokDepthBufferMode";
import { PolymarketPriceAboveDetectionError as PublicError } from "@changmen/venue-browser/polymarket/pmPriceError";
import { PolymarketPriceAboveDetectionError as OldError } from "../../quotes/pmTokenQuote";
import * as publicObserver from "@changmen/venue-browser/pm-book-diagnostics/shadowObserver";
import * as oldObserver from "../../../browser/pm-book-diagnostics/shadowObserver";
import { createReadonlyMarketSource as publicFactory } from "@changmen/venue-browser/pm-book-source";
import { createReadonlyMarketSource as physicalFactory } from "../../../../../client/packages/venue-browser/pm-book-source";

test("public package and legacy entries retain one copy of state functions, observer slot, class and factory", () => {
  for (const [current, previous] of [[publicTick, oldTick], [publicPrefs, oldPrefs], [publicObserver, oldObserver]]) {
    expect(Object.keys(current).sort()).toEqual(Object.keys(previous).sort());
    for (const [name, value] of Object.entries(current)) expect(value).toBe((previous as Record<string, unknown>)[name]);
  }
  expect(PublicError).toBe(OldError);
  expect(publicFactory).toBe(physicalFactory);
});
