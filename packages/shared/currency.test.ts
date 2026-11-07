import assert from "node:assert/strict";
import { it } from "vitest";
import {
  Currency,
  getCurrency,
  getExchange,
  resolveAccountCurrency,
  scaleUsdtToCnyDisplay,
} from "./currency.js";

it("getExchange uses the configured fixed exchange rate", () => {
  assert.equal(getExchange(Currency.CNY), 1);
  assert.equal(getExchange(Currency.USDT), 6.65);
  assert.equal(getExchange(undefined), 1);
  assert.equal(getExchange("USDT"), 6.65);
});

it("getCurrency normalizes venue codes like A8 Pr.getCurrency", () => {
  assert.equal(getCurrency("RMB"), Currency.CNY);
  assert.equal(getCurrency("USD"), Currency.USDT);
  assert.equal(getCurrency("usdc"), Currency.USDT);
  assert.equal(getCurrency(undefined), Currency.CNY);
});

it("resolveAccountCurrency uses venue defaults for USDT platforms", () => {
  assert.equal(resolveAccountCurrency("PredictFun", undefined), Currency.USDT);
  assert.equal(resolveAccountCurrency("PredictFun", "CNY"), Currency.USDT);
  assert.equal(resolveAccountCurrency("Polymarket", ""), Currency.USDT);
  assert.equal(resolveAccountCurrency("OB", undefined), Currency.CNY);
  assert.equal(resolveAccountCurrency("OB", "USDT"), Currency.USDT);
});

it("scaleUsdtToCnyDisplay converts venue USDT to plan CNY", () => {
  assert.equal(scaleUsdtToCnyDisplay(100), 665);
  assert.equal(scaleUsdtToCnyDisplay(Number.NaN), 0);
});
