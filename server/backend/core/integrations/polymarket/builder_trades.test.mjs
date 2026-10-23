import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import fixtures from "./builder_hmac.fixtures.json" with { type: "json" };
import {
  amountToNumber,
  describeBuilderTradesFetchError,
  normalizeBuilderTrade,
  summarizeBuilderTrades,
  fetchBuilderTradesPage,
} from "./builder_trades.js";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("signs the exact Builder query, including filters and cursor, with captured SDK headers", async () => {
  vi.stubEnv("POLY_BUILDER_API_KEY", fixtures.creds.key);
  vi.stubEnv("POLY_BUILDER_SECRET", fixtures.creds.secret);
  vi.stubEnv("POLY_BUILDER_PASSPHRASE", fixtures.creds.passphrase);
  vi.useFakeTimers(); vi.setSystemTime(new Date(1700000000000));
  const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"data":[],"next_cursor":"LTE="}' });
  vi.stubGlobal("fetch", fetch);
  const page = await fetchBuilderTradesPage({ builderCode: "0x123", afterSec: 42.9, nextCursor: "a+b=" });
  assert.deepEqual(page, { data: [], next_cursor: "LTE=" });
  const row = fixtures.cases.find(row => row.method === "GET" && row.timestamp === 1700000000 && row.body === undefined);
  assert.equal(new URL(fetch.mock.calls[0][0]).pathname + new URL(fetch.mock.calls[0][0]).search, row.path);
  assert.deepEqual(fetch.mock.calls[0][1].headers, { ...row.headers, Accept: "application/json" });
  assert.equal(fetch.mock.calls.length, 1);
});

it("refuses Builder queries before HTTP when credentials are missing", async () => {
  for (const key of ["POLY_BUILDER_API_KEY", "POLY_BUILDER_SECRET", "POLY_BUILDER_PASSPHRASE"]) vi.stubEnv(key, "");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await assert.rejects(fetchBuilderTradesPage({ builderCode: "0x123" }), /未配置 POLY_BUILDER/);
  assert.equal(fetch.mock.calls.length, 0);
});

it("amountToNumber accepts live decimals and docs micro integers", () => {
  assert.equal(amountToNumber("5.88"), 5.88);
  assert.equal(amountToNumber("19.6"), 19.6);
  assert.equal(amountToNumber("0.12348"), 0.12348);
  assert.equal(amountToNumber("50000000"), 50);
  assert.equal(amountToNumber("1000000"), 1);
  assert.equal(amountToNumber("50"), 50);
  assert.equal(amountToNumber(""), 0);
});

it("normalizeBuilderTrade converts micro USDC and match time", () => {
  const row = normalizeBuilderTrade({
    id: "t1",
    side: "BUY",
    size: "1000000",
    sizeUsdc: "500000",
    feeUsdc: "1000",
    price: "0.5",
    matchTime: "1700000000",
    maker: "0x1234567890123456789012345678901234567890",
  });
  assert.equal(row.sizeUsdc, 0.5);
  assert.equal(row.sizeShares, 1);
  assert.equal(row.feeUsdc, 0.001);
  assert.equal(row.displayFeeUsdc, 0.001);
  assert.equal(row.matchTime, 1700000000_000);
});

it("normalizeBuilderTrade keeps live human USDC amounts", () => {
  const row = normalizeBuilderTrade({
    id: "t2",
    side: "BUY",
    size: "19.6",
    sizeUsdc: "5.88",
    feeUsdc: "0.12348",
    builderFee: "0",
    price: "0.3",
    matchTime: "1783594418",
  });
  assert.equal(row.sizeShares, 19.6);
  assert.equal(row.sizeUsdc, 5.88);
  assert.equal(row.feeUsdc, 0.12348);
  assert.equal(row.builderFeeUsdc, 0);
  assert.equal(row.displayFeeUsdc, 0.12348);
});

it("normalizeBuilderTrade prefers builderFee when present", () => {
  const row = normalizeBuilderTrade({
    sizeUsdc: "10",
    feeUsdc: "0.2",
    builderFee: "0.05",
  });
  assert.equal(row.displayFeeUsdc, 0.05);
});

it("describeBuilderTradesFetchError unwraps Node fetch failed + cause", () => {
  const err = new TypeError("fetch failed");
  err.cause = Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" });
  const msg = describeBuilderTradesFetchError(err, "https://clob.polymarket.com/builder/trades");
  assert.match(msg, /fetch failed/);
  assert.match(msg, /UND_ERR_CONNECT_TIMEOUT/);
  assert.match(msg, /VITE_API_PROXY/);
  assert.match(msg, /clob\.polymarket\.com/);
});

it("describeBuilderTradesFetchError does not double-wrap", () => {
  const once = describeBuilderTradesFetchError(new TypeError("fetch failed"));
  const twice = describeBuilderTradesFetchError(new Error(once));
  assert.equal(twice, once);
});

it("describeBuilderTradesFetchError keeps HTTP status and missing creds", () => {
  assert.equal(
    describeBuilderTradesFetchError(new Error("Polymarket builder/trades 401: unauthorized")),
    "Polymarket builder/trades 401: unauthorized",
  );
  assert.match(
    describeBuilderTradesFetchError(new Error("未配置 POLY_BUILDER_API_KEY/SECRET/PASSPHRASE，无法查询 Builder 成交")),
    /^未配置 POLY_BUILDER/,
  );
});

it("summarizeBuilderTrades aggregates volume and fees by side", () => {
  const s = summarizeBuilderTrades([
    { side: "BUY", sizeUsdc: 10, feeUsdc: 0.1, builderFeeUsdc: 0.05 },
    { side: "SELL", sizeUsdc: 5, feeUsdc: 0.05, builderFeeUsdc: 0.02 },
  ]);
  assert.equal(s.tradeCount, 2);
  assert.equal(s.volumeUsdc, 15);
  assert.ok(Math.abs(s.feeUsdc - 0.15) < 1e-9);
  assert.ok(Math.abs(s.builderFeeUsdc - 0.07) < 1e-9);
  assert.equal(s.buyCount, 1);
  assert.equal(s.sellCount, 1);
  assert.equal(s.buyVolumeUsdc, 10);
  assert.equal(s.sellVolumeUsdc, 5);
  assert.ok(Math.abs(s.buyFeeUsdc - 0.1) < 1e-9);
  assert.ok(Math.abs(s.sellFeeUsdc - 0.05) < 1e-9);
  assert.ok(Math.abs(s.buyBuilderFeeUsdc - 0.05) < 1e-9);
  assert.ok(Math.abs(s.sellBuilderFeeUsdc - 0.02) < 1e-9);
});
