import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { directGet } from "@changmen/client-core/shared/http";
import { browserSubmitClockReady, browserSubmitTimestamp, clearBrowserSubmitClockForTests, prepareBrowserSubmitClock } from "./pmBrowserSubmitClock";
vi.mock("@changmen/client-core/shared/http", () => ({ directGet: vi.fn() }));
const gateway = "https://clob.polymarket.com";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance", "Date"] });
  clearBrowserSubmitClockForTests();
  vi.mocked(directGet).mockReset().mockResolvedValue(1_791_328_000);
});
afterEach(() => vi.useRealTimers());

it("shares calibration across accounts on an origin and avoids requests on hot preparation", async () => {
  await Promise.all([prepareBrowserSubmitClock(gateway), prepareBrowserSubmitClock(`${gateway}/`)]);
  await prepareBrowserSubmitClock(gateway);
  expect(directGet).toHaveBeenCalledOnce();
  expect(directGet).toHaveBeenCalledWith(`${gateway}/time`, {}, { timeout: 2_000 });
  expect(browserSubmitClockReady(gateway)).toBe(true);
});

it("uses server time plus monotonic elapsed time even if the user's wall clock jumps", async () => {
  vi.setSystemTime(new Date("2020-01-01"));
  await prepareBrowserSubmitClock(gateway);
  vi.advanceTimersByTime(2_500);
  vi.setSystemTime(new Date("2040-01-01"));
  expect(browserSubmitTimestamp(gateway)).toBe(1_791_328_002);
  expect(directGet).toHaveBeenCalledOnce();
});

it("expired or absent samples reject locally; only a new precheck recalibrates", async () => {
  expect(() => browserSubmitTimestamp(gateway)).toThrow("校时未就绪");
  await prepareBrowserSubmitClock(gateway);
  vi.advanceTimersByTime(120_000);
  expect(browserSubmitClockReady(gateway)).toBe(false);
  expect(() => browserSubmitTimestamp(gateway)).toThrow("校时未就绪");
  expect(directGet).toHaveBeenCalledOnce();
  await prepareBrowserSubmitClock(gateway);
  expect(directGet).toHaveBeenCalledTimes(2);
});

it.each([null, {}, "bad", -1, 0, true, 1.2])("rejects invalid server samples (%s) before POST", async value => {
  vi.mocked(directGet).mockResolvedValue(value);
  await expect(prepareBrowserSubmitClock(gateway)).rejects.toThrow("时间采样失败");
  expect(browserSubmitClockReady(gateway)).toBe(false);
});

it("rejects a delayed time sample and permits a fresh attempt after a failed request", async () => {
  vi.mocked(directGet).mockImplementationOnce(async () => {
    vi.advanceTimersByTime(2_001);
    return 1_791_328_000;
  });
  await expect(prepareBrowserSubmitClock(gateway)).rejects.toThrow("时间采样失败");
  vi.mocked(directGet).mockRejectedValueOnce(new Error("Network Error"));
  await expect(prepareBrowserSubmitClock(gateway)).rejects.toThrow("Network Error");
  await prepareBrowserSubmitClock(gateway);
  expect(browserSubmitClockReady(gateway)).toBe(true);
});
