import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { reactive } from "vue";
import { setPmFokPreflightMode, capturePmFokPreflightMode } from "@changmen/venue-browser/adapter/polymarket/pmFokPreflightMode";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { installPmDynamicWsPreflight, stopPmDynamicWsPreflight } from "./pmDynamicWsPreflight";
import { setPmBookSetting } from "./pmBookSettings";
const io = vi.hoisted(() => ({ user: {} as { isLoggedIn: boolean; ready: boolean; userId: number; extensionPrefs: { pmFokPreflightMode: string } },
  start: vi.fn(), stop: vi.fn() }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => io.user }));
vi.mock("./pmMarketData", () => ({ startPmMarketData: io.start }));
beforeEach(() => {
  vi.useFakeTimers(); io.start.mockReset().mockReturnValue({ stop: io.stop, reconcile: vi.fn() }); io.stop.mockReset();
  io.user = reactive({ isLoggedIn: true, ready: true, userId: 1, extensionPrefs: { pmFokPreflightMode: "optimized" } });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  localStorage.setItem("changmen:pm:local-book", "1"); setPmFokPreflightMode("legacy");
});
afterEach(() => { stopPmDynamicWsPreflight(); setPmFokPreflightMode("legacy"); localStorage.removeItem("changmen:pm:local-book"); vi.useRealTimers(); vi.unstubAllGlobals(); });
test.each(["legacy", undefined, "invalid"])("%s never loads worker, timers or candidate watchers even with unsaved optimized form", async mode => {
  setPmFokPreflightMode(mode); installPmDynamicWsPreflight();
  await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(60_000);
  expect(io.start).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
test("release flag defaults off; optimized is insufficient by itself", async () => {
  localStorage.removeItem("changmen:pm:local-book"); setPmFokPreflightMode("optimized"); installPmDynamicWsPreflight();
  await vi.dynamicImportSettled(); expect(io.start).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
test("old shadow flag never implicitly enables the independent master switch", async () => {
  localStorage.removeItem("changmen:pm:local-book"); localStorage.setItem("changmen:pm:ws-book-shadow", "1");
  try {
    setPmFokPreflightMode("optimized"); installPmDynamicWsPreflight(); await vi.dynamicImportSettled();
    expect(io.start).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  } finally { localStorage.removeItem("changmen:pm:ws-book-shadow"); }
});
test("mode switch destroys worker synchronously but cannot rewrite a captured attempt", async () => {
  installPmDynamicWsPreflight(); setPmFokPreflightMode("optimized"); await vi.dynamicImportSettled();
  expect(io.start).toHaveBeenCalledOnce();
  const option = {} as BetOption; expect(capturePmFokPreflightMode(option)).toBe("optimized");
  setPmFokPreflightMode("legacy"); expect(io.stop).toHaveBeenCalledOnce();
  expect(capturePmFokPreflightMode(option)).toBe("optimized");
  expect(capturePmFokPreflightMode({} as BetOption)).toBe("legacy");
});
test("late dynamic import and logged-out sessions cannot restart shadow tasks", async () => {
  setPmFokPreflightMode("optimized"); installPmDynamicWsPreflight(); setPmFokPreflightMode("legacy");
  await vi.dynamicImportSettled(); expect(io.start).not.toHaveBeenCalled();
  io.user.isLoggedIn = false; setPmFokPreflightMode("optimized"); await vi.dynamicImportSettled(); expect(io.start).not.toHaveBeenCalled();
  io.user.isLoggedIn = true; await vi.dynamicImportSettled(); expect(io.start).toHaveBeenCalledOnce();
  io.user.ready = false; expect(io.stop).toHaveBeenCalledOnce();
});

test("same-tab settings start/stop immediately; consumer changes do not restart the owner", async () => {
  localStorage.removeItem("changmen:pm:local-book");
  setPmFokPreflightMode("optimized"); installPmDynamicWsPreflight();
  setPmBookSetting("localBook", true); await vi.dynamicImportSettled();
  expect(io.start).toHaveBeenCalledOnce();
  const owner = io.start.mock.results[0]!.value;
  try {
    setPmBookSetting("shadow", true);
    setPmBookSetting("shadow", false);
    expect(owner.reconcile).toHaveBeenCalledTimes(2);
    expect(io.start).toHaveBeenCalledOnce(); expect(io.stop).not.toHaveBeenCalled();
    setPmBookSetting("localBook", false); expect(io.stop).toHaveBeenCalledOnce();
    setPmBookSetting("localBook", true); setPmBookSetting("localBook", false);
    await vi.dynamicImportSettled(); expect(io.start).toHaveBeenCalledOnce();
  } finally { localStorage.removeItem("changmen:pm:ws-book-shadow"); }
});

test("settings notifications cannot activate classic FOK, and are removed on shutdown", async () => {
  installPmDynamicWsPreflight(); setPmBookSetting("localBook", true);
  await vi.dynamicImportSettled(); expect(io.start).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  stopPmDynamicWsPreflight(); setPmFokPreflightMode("optimized"); setPmBookSetting("localBook", true);
  await vi.dynamicImportSettled(); expect(io.start).not.toHaveBeenCalled();
});
