import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { beginRayNativeOrderDisplay, lookupRayNativeOrderDisplay, rayNativeOrderDisplayStatus, resetRayNativeOrderDisplay } from "./nativeOrderDisplay";

const created = Date.parse("2026-11-10T12:00:00+08:00");
const row = { order_number: "one", status: 0, create_time: "2026-11-10 12:00:00", live: 1, detail: [{ live: 0, risk: 0, win: -1 }] };
const account = () => new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY", gateway: "https://ray.example", token: "test" });
beforeEach(() => { resetRayNativeOrderDisplay(); vi.useFakeTimers(); vi.setSystemTime(created + 30_000); });
afterEach(() => vi.useRealTimers());

it.each([[-1, "Open"], [0, "Pending"], [30_000, "Pending"], [34_999, "Pending"], [35_000, "Pending"], [35_999, "Pending"], [36_000, "Open"]])("H5 live window at %s milliseconds is %s", (age, expected) => {
  expect(rayNativeOrderDisplayStatus(row, created + Number(age))).toBe(expected);
});
it("uses only order.live and recognizes risk 1/2 across all legs, including pre-match after 35 seconds", () => {
  expect(rayNativeOrderDisplayStatus({ ...row, live: 0, detail: [{ live: 0 }, { live: 1 }] }, created + 30_000)).toBe("Open");
  expect(rayNativeOrderDisplayStatus({ ...row, live: 0 }, created)).toBe("Open");
  const risk = { ...row, live: 0, detail: [{ risk: 0 }, { risk: 2, win: -1 }] };
  expect(rayNativeOrderDisplayStatus(risk, created + 600_000)).toBe("Pending");
  expect(rayNativeOrderDisplayStatus({ ...risk, detail: [{ risk: 2, win: 0 }] }, created + 600_000)).toBe("Open");
  expect(rayNativeOrderDisplayStatus({ ...risk, detail: [{ risk: 3, win: -1 }] }, created + 600_000)).toBe("Open");
  expect(rayNativeOrderDisplayStatus({ ...risk, status: "0", live: "1", detail: [{ risk: "1", win: "-1" }] }, created + 600_000)).toBe("Pending");
});
it("matches the H5 date helper's undefined default without using the server clock as creation time", () => {
  const create_time = undefined;
  expect(rayNativeOrderDisplayStatus({ ...row, create_time }, Date.now())).toBe("Pending");
  expect(rayNativeOrderDisplayStatus({ ...row, create_time }, Date.now() + 36_000)).toBe("Open");
  expect(rayNativeOrderDisplayStatus({ ...row, create_time, live: 0 }, Date.now())).toBe("Open");
});
it.each(["", null, "invalid"])("invalid/null H5 creation time %s does not invent a live window", create_time => {
  expect(rayNativeOrderDisplayStatus({ ...row, create_time }, created + 10_000)).toBe("Open");
  expect(rayNativeOrderDisplayStatus({ ...row, create_time, detail: [{ risk: 2, win: -1 }] }, created)).toBe("Pending");
});
it.each(["2026/11/10 12:00:00", "2026-11-10T04:00:00Z", "2026-11-10T12:00:00+0800", "2026-11-10T12:00:00.000+08:00"])("normalizes H5 creation time %s", create_time => {
  expect(rayNativeOrderDisplayStatus({ ...row, create_time }, created + 35_999)).toBe("Pending");
  expect(rayNativeOrderDisplayStatus({ ...row, create_time }, created + 36_000)).toBe("Open");
});
it.each([0, 4])("H5 aggregate status %s distinguishes rejected/returned from detail risk after the live window", status => {
  expect(rayNativeOrderDisplayStatus({ ...row, status, detail: [{ risk: 2, win: 99 }] }, created + 60_000)).toBe("Rejected");
  expect(rayNativeOrderDisplayStatus({ ...row, status, detail: [{ risk: 0, win: 99 }] }, created + 60_000)).toBe("Returned");
});
it("keeps H5 branch priority for recent-live, mixed details, settled and unknown statuses", () => {
  expect(rayNativeOrderDisplayStatus({ ...row, detail: [{ risk: 2, win: 99 }] }, created)).toBe("Pending");
  expect(rayNativeOrderDisplayStatus({ ...row, status: 4, detail: [] }, created)).toBe("Rejected");
  expect(rayNativeOrderDisplayStatus({ ...row, detail: [{ risk: 2, win: 99 }, { risk: 0, win: -1 }] }, created + 60_000)).toBe("Open");
  expect(rayNativeOrderDisplayStatus({ ...row, status: 1, detail: [{ risk: 2, win: -1 }] }, created)).toBe("Settled");
  expect(rayNativeOrderDisplayStatus({ ...row, status: 9 }, created)).toBe("Open");
});
it("uses server time plus elapsed local time, without mutating or serializing native facts into orders", () => {
  const acc = account();
  vi.setSystemTime(created + 3_600_000);
  beginRayNativeOrderDisplay(acc)([row], new Date(created + 30_000).toISOString());
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBe("Pending");
  vi.advanceTimersByTime(6000);
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBe("Open");
  expect(row).toEqual({ order_number: "one", status: 0, create_time: "2026-11-10 12:00:00", live: 1, detail: [{ live: 0, risk: 0, win: -1 }] });
});
it("discards a slow older response after a newer rejection, and separates account instances and credentials", () => {
  const acc = account(), older = beginRayNativeOrderDisplay(acc), newer = beginRayNativeOrderDisplay(acc);
  newer([{ ...row, status: 4 }]); older([row]);
  expect(lookupRayNativeOrderDisplay(reactive(acc), "one")).toBe("Rejected");
  expect(lookupRayNativeOrderDisplay(account(), "one")).toBeUndefined();
  acc.token = "changed";
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBeUndefined();
});
it("uses the H5 row clock offset only when no response clock is available", () => {
  const acc = account();
  vi.setSystemTime(created + 3_600_000);
  const offsetRow = { ...row, server_time_offset_ms: -3_570_000 };
  beginRayNativeOrderDisplay(acc)([offsetRow]);
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBe("Pending");
  beginRayNativeOrderDisplay(acc)([offsetRow], new Date(created + 60_000).toISOString());
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBe("Open");
});
it("a reset fences in-flight display responses; empty lists and missing IDs do not invent state", () => {
  const acc = account(), publish = beginRayNativeOrderDisplay(acc);
  resetRayNativeOrderDisplay(); publish([row]);
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBeUndefined();
  beginRayNativeOrderDisplay(acc)([row]);
  expect(lookupRayNativeOrderDisplay(acc, "other")).toBeUndefined();
  beginRayNativeOrderDisplay(acc)([]);
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBeUndefined();
});

it("a newer query invalidates older UI publications before it completes, retaining the last valid snapshot", () => {
  const acc = account();
  beginRayNativeOrderDisplay(acc)([{ ...row, live: 0 }]);
  const obsolete = beginRayNativeOrderDisplay(acc);
  const replacement = beginRayNativeOrderDisplay(reactive(acc));
  obsolete([{ ...row, status: 4 }]);
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBe("Open");
  replacement([{ ...row, status: 4 }]);
  expect(lookupRayNativeOrderDisplay(acc, "one")).toBe("Rejected");
});
