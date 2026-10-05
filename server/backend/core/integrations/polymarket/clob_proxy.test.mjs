import { describe, expect, it, vi } from "vitest";
import {
  executePolymarketHttpRequest,
  isAllowedPolymarketUrl,
  pickPolymarketPolyHeaders,
} from "./clob_proxy.js";

describe("clob_proxy", () => {
  it("isAllowedPolymarketUrl accepts gamma/clob", () => {
    expect(isAllowedPolymarketUrl("https://data-api.polymarket.com/v2/activity")).toBe(true);
    expect(isAllowedPolymarketUrl("https://gamma-api.polymarket.com/events")).toBe(true);
    expect(isAllowedPolymarketUrl("https://clob.polymarket.com/time")).toBe(true);
    expect(isAllowedPolymarketUrl("https://api.predict.fun/v1/tags")).toBe(false);
    expect(isAllowedPolymarketUrl("http://clob.polymarket.com/time")).toBe(false);
  });

  it("forwards only retry and trace headers on upstream errors", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      JSON.stringify({ code: "rate_limited", error: "busy", retryable: true }),
      { status: 429, headers: { "retry-after": "2", "x-trace-id": "trace", "set-cookie": "private", "authorization": "private" } },
    ));
    try {
      const result = await executePolymarketHttpRequest({ method: "GET", url: "https://data-api.polymarket.com/v2/activity" });
      expect(result.status).toBe(429);
      expect(result.headers).toEqual({ "retry-after": "2", "x-trace-id": "trace" });
      expect(JSON.parse(result.text).code).toBe("rate_limited");
    }
    finally {
      mock.mockRestore();
    }
  });

  it("pickPolymarketPolyHeaders keeps POLY_* only", () => {
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

  it("executePolymarketHttpRequest public GET /time", async () => {
    const result = await executePolymarketHttpRequest({
      method: "GET",
      url: "https://clob.polymarket.com/time",
    });
    expect(result.status).toBe(200);
    expect(Number(result.text.trim())).toBeGreaterThan(0);
  });
});
