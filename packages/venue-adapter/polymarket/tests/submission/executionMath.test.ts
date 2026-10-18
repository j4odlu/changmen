import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { expect, test } from "vitest";
import { simulateExecutableBuy } from "../../submission/preflight/optimized/wsBook/executionMath";
import { isValidClobPrice } from "../../pmDetection";
import { PolymarketPriceAboveDetectionError } from "../../pmTokenQuote";
import { alignPolymarketPriceToTick, isPolymarketPriceOnTick } from "../../pmTickPrice";
import { pmBuyOrderShares } from "../../pmBuyOrderShares";
import { pmFokDepthBufferNeedUsdc, pmFokFillPriceDepthUsdc } from "../../pmFokDepthBufferMode";
import { truncateOddsTo3 } from "@changmen/shared/odds_format";

const original = readFileSync(new URL("../../fok/preflight.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const mirror = readFileSync(new URL("../../../browser/pm-book-diagnostics/executionMath.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const ranges = [
  ["function polymarketFokLimitFromDetection(", "\ninterface PolymarketOrderDiagnostic"],
  ["function fmt(", "\nasync function resolvePolymarketExecutableBuy("],
  ["function calculateBuyMarketLimitPrice(", "\n/** 下单 USDC"],
];
const bodies = ranges.map(([a, b]) => original.slice(original.indexOf(a!), original.indexOf(b!, original.indexOf(a!))).trim().replaceAll("export function ", "function "));
test("diagnostic math retains exact original algorithm bodies, including error messages and depth buffer", () => {
  for (const body of bodies) expect(mirror).toContain(body);
});
test("10,000 deterministic same-input calculations match original FOK functions across 20 asset IDs", () => {
  let prefs = { enabled: false, multiplier: 1.5 };
  const code = transformSync(bodies.join("\n"), { loader: "ts", format: "cjs" }).code;
  const reference = new Function("isValidClobPrice", "alignPolymarketPriceToTick", "isPolymarketPriceOnTick", "PolymarketPriceAboveDetectionError",
    "pmFokDepthBufferNeedUsdc", "pmFokFillPriceDepthUsdc", "getPmFokDepthBufferPrefs",
    code + ";return { calculateBuyMarketLimitPrice, polymarketFokLimitFromDetection, availableUsdcAtPrice };")(
    isValidClobPrice, alignPolymarketPriceToTick, isPolymarketPriceOnTick, PolymarketPriceAboveDetectionError,
    (amount: number) => pmFokDepthBufferNeedUsdc(amount, prefs), pmFokFillPriceDepthUsdc, () => prefs);
  const capture = (fn: () => unknown) => { try { return { value: fn() }; } catch (e) { return { error: (e as Error).message }; } };
  let successes = 0, rejected = 0;
  for (let i = 0; i < 10_000; i++) {
    const tick = (["0.1", "0.01", "0.001", "0.0001"] as const)[i % 4]!;
    const tokenId = String(i % 20 + 1), amount = (i % 179 + 1) / 11, maxPrice = (i % 87 + 10) / 100;
    prefs = { enabled: i % 3 === 0, multiplier: 1.1 + (i % 40) / 10 };
    const asks = Array.from({ length: i % 16 }, (_, n) => ({ price: (n + i % 12 + 1) / 50, size: (i % 23 + 1) / 3 }));
    const options = { version: 2 as const, bookTimestamp: 1, tickSize: tick, minOrderSize: i % 5 + 1, negRisk: false, asks };
    const input = { tokenId, detectionOdds: 1 / maxPrice, apiBetMoney: amount, maxPrice, depth: { ...prefs } };
    const expected = capture(() => {
      const price = reference.calculateBuyMarketLimitPrice(asks, amount, options.minOrderSize,
        { tokenId, amountUsdc: amount, displayedOdds: input.detectionOdds, displayedPrice: maxPrice, minOrderSize: options.minOrderSize }, maxPrice);
      const limitPrice = reference.polymarketFokLimitFromDetection(maxPrice, tick, price);
      const shares = pmBuyOrderShares(amount, limitPrice, tick);
      if (!Number.isFinite(shares) || shares < options.minOrderSize) throw Error("Polymarket 下单金额低于最小份数（实际签单限价）");
      return { price, limitPrice, shares, bookOdds: truncateOddsTo3(1 / price), depthAvailableAtCap: reference.availableUsdcAtPrice(asks, maxPrice),
        depthNeedUsdc: pmFokDepthBufferNeedUsdc(amount, prefs) ?? amount };
    });
    const actual = capture(() => simulateExecutableBuy(input, options));
    expect(actual, `case ${i}`).toEqual(expected);
    if ("value" in expected) successes++; else rejected++;
  }
  expect(successes).toBeGreaterThan(100); expect(rejected).toBeGreaterThan(100);
});
