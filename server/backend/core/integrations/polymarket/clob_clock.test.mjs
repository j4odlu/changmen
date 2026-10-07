import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { prepareClobClock, clobTimestamp, clearClobClocksForTests } from "./clob_clock.js";
import { executePolymarketHttpRequest } from "./clob_proxy.js";
import { buildPolymarketL2HeadersFromToken } from "./clob_l2.js";

const origin = "https://clob.polymarket.com";
const token = JSON.stringify({ walletAddress: "0xabc", apiCreds: { apiKey: "key", secret: "c2VjcmV0", passphrase: "pass" } });
beforeEach(() => { clearClobClocksForTests(); vi.useFakeTimers(); vi.setSystemTime(1_700_000_000_000); });
afterEach(() => { clearClobClocksForTests(); vi.restoreAllMocks(); vi.useRealTimers(); });

test("cold precheck shares calibration, consecutive orders only POST with fresh exact-body HMAC", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async url =>
    new Response(String(url).endsWith("/time") ? "1700000000" : '{"success":true}', { status: 200 }));
  await Promise.all([prepareClobClock(origin), prepareClobClock(origin)]);
  expect(fetchMock).toHaveBeenCalledOnce();
  const body = '{"order":{"a":1}, "orderType":"FOK"}';
  for (let i = 0; i < 2; i++) {
    const timestamp = clobTimestamp(origin);
    await executePolymarketHttpRequest({ url: `${origin}/order`, method: "POST", l2Path: "/order", accountToken: token, body });
    const [, init] = fetchMock.mock.calls.at(-1);
    expect(init.body).toBe(body);
    expect(init.headers).toMatchObject(buildPolymarketL2HeadersFromToken(token, "POST", "/order", body, timestamp));
    await vi.advanceTimersByTimeAsync(1_000);
  }
  expect(fetchMock.mock.calls.map(c => c[0])).toEqual([`${origin}/time`, `${origin}/order`, `${origin}/order`]);
  expect(fetchMock.mock.calls[1][1].headers.POLY_TIMESTAMP).not.toBe(fetchMock.mock.calls[2][1].headers.POLY_TIMESTAMP);
});

test("unready clock and wall-clock jumps reject submission locally without time or order calls", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("1700000000"));
  const submit = () => executePolymarketHttpRequest({ url: `${origin}/order`, method: "POST", l2Path: "/order", accountToken: token, body: {} });
  await expect(submit()).rejects.toThrow("校时未就绪"); expect(fetchMock).not.toHaveBeenCalled();
  await prepareClobClock(origin);
  fetchMock.mockClear(); vi.setSystemTime(Date.now() + 5_000);
  await expect(submit()).rejects.toThrow("校时未就绪"); expect(fetchMock).not.toHaveBeenCalled();
});

test("invalid /time response is never marked ready", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("0", { status: 503 }));
  await expect(prepareClobClock(origin)).rejects.toThrow("校时失败");
  expect(() => clobTimestamp(origin)).toThrow("未就绪");
});


test("background calibration resumes after a transient failure", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(String(Date.now() / 1_000)));
  await prepareClobClock(origin);
  fetchMock.mockRejectedValueOnce(new Error("network offline"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(clobTimestamp(origin)).toBe(Math.floor(Date.now() / 1_000));
});

test("extension fallback keeps client-clock authentication on a cold VPS without /time", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"success":true}'));
  const body = '{"orderType":"FOK","order":{"a":1}}';
  await executePolymarketHttpRequest({ url: `${origin}/order`, method: "POST", l2Path: "/order", accountToken: token, body,
    clientL2Timestamp: 1_700_000_000 });
  expect(fetchMock.mock.calls.map(c => c[0])).toEqual([`${origin}/order`]);
  expect(fetchMock.mock.calls[0][1].headers).toMatchObject(buildPolymarketL2HeadersFromToken(token, "POST", "/order", body, 1_700_000_000));
});

test.each([null, "1700000000", 0, -1, 1.5, Number.POSITIVE_INFINITY])("invalid fallback timestamp %s never reaches CLOB", async clientL2Timestamp => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  await expect(executePolymarketHttpRequest({ url: `${origin}/order`, method: "POST", l2Path: "/order", accountToken: token,
    body: {}, clientL2Timestamp })).rejects.toThrow("客户端签名时间无效");
  expect(fetchMock).not.toHaveBeenCalled();
});
