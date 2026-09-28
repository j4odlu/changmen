import { describe, expect, test } from "vitest";
import {
  executePolymarketHttpRequest,
  isAllowedPolymarketUrl,
  pickPolymarketPolyHeaders,
} from "./clob_proxy.js";

describe("clob_proxy", () => {
  test("isAllowedPolymarketUrl accepts gamma/clob", () => {
    expect(isAllowedPolymarketUrl("https://gamma-api.polymarket.com/events")).toBe(true);
    expect(isAllowedPolymarketUrl("https://clob.polymarket.com/time")).toBe(true);
    expect(isAllowedPolymarketUrl("https://api.predict.fun/v1/tags")).toBe(false);
    expect(isAllowedPolymarketUrl("http://clob.polymarket.com/time")).toBe(false);
  });

  test("pickPolymarketPolyHeaders keeps POLY_* only", () => {
    expect(pickPolymarketPolyHeaders({
      POLY_ADDRESS: "0xabc",
      POLY_SIGNATURE: "sig",
      POLY_TIMESTAMP: "1",
      POLY_NONCE: "0",
      POLY_API_KEY: "k",
      POLY_PASSPHRASE: "p",
      Host: "ignored",
    })).toEqual({
      POLY_ADDRESS: "0xabc",
      POLY_SIGNATURE: "sig",
      POLY_TIMESTAMP: "1",
      POLY_NONCE: "0",
      POLY_API_KEY: "k",
      POLY_PASSPHRASE: "p",
    });
  });

  test("executePolymarketHttpRequest public GET /time", async () => {
    const result = await executePolymarketHttpRequest({
      method: "GET",
      url: "https://clob.polymarket.com/time",
    });
    expect(result.status).toBe(200);
    expect(Number(result.text.trim())).toBeGreaterThan(0);
  });
});
