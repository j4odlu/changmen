import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { clearPmPublicRoutesForTests, sharePublicGet, withPublicRoute } from "./pmPublicRoute";

beforeEach(() => { clearPmPublicRoutesForTests(); vi.useFakeTimers({ toFake: ["performance"] }); });
afterEach(() => vi.useRealTimers());
const url = "https://clob.polymarket.com/book?token_id=1";
const isNetwork = (e: unknown) => e === "network";

test("two network failures cool down only that origin; one half-open probe", async () => {
  const direct = vi.fn().mockRejectedValue("network");
  const fallback = vi.fn().mockResolvedValue("vps");
  const run = (u = url) => withPublicRoute(u, direct, fallback, isNetwork);
  await run(); await run(); await run();
  expect(direct).toHaveBeenCalledTimes(2);
  await run("https://gamma-api.polymarket.com/events/1");
  expect(direct).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(30_001);
  let release!: (value: string) => void;
  direct.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const probe = run();
  expect(await run()).toBe("vps");
  expect(direct).toHaveBeenCalledTimes(4);
  release("direct"); await probe;
  direct.mockResolvedValue("direct");
  expect(await run()).toBe("direct");
});

test("HTTP 429 fails without a fallback or health penalty", async () => {
  const direct = vi.fn().mockRejectedValue(429);
  const fallback = vi.fn();
  for (let i = 0; i < 3; i++) await expect(withPublicRoute(url, direct, fallback, isNetwork)).rejects.toBe(429);
  expect(direct).toHaveBeenCalledTimes(3); expect(fallback).not.toHaveBeenCalled();
});

test("only concurrent identical public GETs share work; results have independent ownership", async () => {
  let release!: (value: { asks: number[] }) => void;
  const request = vi.fn(() => new Promise<{ asks: number[] }>(resolve => { release = resolve; }));
  const a = sharePublicGet("same", request); const b = sharePublicGet("same", request);
  release({ asks: [1] });
  const [x, y] = await Promise.all([a, b]);
  x.asks.push(2); expect(y.asks).toEqual([1]); expect(request).toHaveBeenCalledOnce();
  const next = sharePublicGet("same", request); release({ asks: [3] }); await next;
  expect(request).toHaveBeenCalledTimes(2);
  await expect(sharePublicGet("error", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  expect(await sharePublicGet("error", async () => 1)).toBe(1);
});
