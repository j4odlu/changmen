import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { a8PluginSend, a8PluginGetStore, hasA8PluginRuntime } = vi.hoisted(() => ({
  a8PluginSend: vi.fn(),
  a8PluginGetStore: vi.fn(),
  hasA8PluginRuntime: vi.fn(() => true),
}));

vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({
  a8PluginSend: (...args: unknown[]) => a8PluginSend(...args),
  a8PluginGetStore: (...args: unknown[]) => a8PluginGetStore(...args),
  hasA8PluginRuntime: () => hasA8PluginRuntime(),
}));

import {
  isPbLiveTabDead,
  isPbTabMiss,
  parsePbLiveTabId,
  parsePbTabIdFromStore,
  pbLiveTabHardError,
  readPbTabIdFromPlugin,
  setPbTabIdCached,
} from "./tabId";

describe("parsePbTabIdFromStore", () => {
  test("reads PB tab id from plugin store shapes", () => {
    expect(parsePbTabIdFromStore(42)).toBe(42);
    expect(parsePbTabIdFromStore({ data: { PB: 99 } })).toBe(99);
    expect(parsePbTabIdFromStore({ response: { data: { PB: 77 } } })).toBe(77);
    expect(parsePbTabIdFromStore({ data: { Stake: 1 } })).toBeUndefined();
    expect(parsePbTabIdFromStore(0)).toBeUndefined();
  });
});

describe("parsePbLiveTabId", () => {
  test("only accepts positive tab ids", () => {
    expect(parsePbLiveTabId(88)).toBe(88);
    expect(parsePbLiveTabId(0)).toBeUndefined();
    expect(parsePbLiveTabId(null)).toBeUndefined();
    expect(parsePbLiveTabId({ data: { PB: 99 } })).toBeUndefined();
    expect(parsePbLiveTabId({ tabId: 77, debug: { ports: [] } })).toBe(77);
    expect(parsePbLiveTabId({ tabId: null })).toBeUndefined();
  });
});

describe("readPbTabIdFromPlugin", () => {
  beforeEach(() => {
    a8PluginSend.mockReset();
    a8PluginGetStore.mockReset();
    hasA8PluginRuntime.mockReturnValue(true);
    setPbTabIdCached(undefined);
  });

  afterEach(() => {
    setPbTabIdCached(undefined);
  });

  test("queries live tab by pasted referer host, not last setTab(PB)", async () => {
    a8PluginSend.mockResolvedValue({ tabId: 321, debug: { ports: [] } });
    a8PluginGetStore.mockResolvedValue({ data: { PB: 11 } });
    const tabId = await readPbTabIdFromPlugin({
      provider: "PB",
      referer: "https://skin.example/zh-cn/compact/sports",
      gateway: "https://unused.example",
    });
    expect(tabId).toBe(321);
    expect(a8PluginSend).toHaveBeenCalledWith({
      type: "getPbLiveTab",
      data: { hosts: ["skin.example"] },
    });
    expect(a8PluginGetStore).not.toHaveBeenCalled();
  });

  test("queries live tab with bound venueMemberId so same-host logins do not mix", async () => {
    a8PluginSend.mockResolvedValue({ tabId: 77 });
    const tabId = await readPbTabIdFromPlugin({
      provider: "PB",
      referer: "https://www.part888.com/sports",
      venueMemberId: "GB18ID",
    });
    expect(tabId).toBe(77);
    expect(a8PluginSend).toHaveBeenCalledWith({
      type: "getPbLiveTab",
      data: { hosts: ["www.part888.com"], venueMemberId: "GB18ID" },
    });
  });

  test("does not fall back to another skin when paste host has no tab", async () => {
    a8PluginSend.mockResolvedValue(null);
    a8PluginGetStore.mockResolvedValue({ data: { PB: 11 } });
    const tabId = await readPbTabIdFromPlugin({
      provider: "PB",
      referer: "https://skin.example/sports",
    });
    expect(tabId).toBeUndefined();
    expect(a8PluginGetStore).not.toHaveBeenCalled();
  });

  test("falls back to store when account has no referer/gateway", async () => {
    a8PluginGetStore.mockResolvedValue({ data: { PB: 44 } });
    const tabId = await readPbTabIdFromPlugin({ provider: "PB" });
    expect(tabId).toBe(44);
    expect(a8PluginSend).not.toHaveBeenCalled();
  });
});

describe("isPbTabMiss", () => {
  test("detects closed tab errors", () => {
    expect(isPbTabMiss(new Error("标签页通信失败"))).toBe(true);
    expect(isPbTabMiss("Could not establish connection. Receiving end does not exist.")).toBe(true);
    expect(isPbTabMiss({ message: "Receiving end does not exist" })).toBe(true);
    expect(isPbTabMiss({ data: { success: true } })).toBe(false);
    expect(isPbTabMiss("Request failed with status code 403")).toBe(false);
    expect(isPbTabMiss(new Error("PB live tab host mismatch"))).toBe(true);
    expect(isPbTabMiss(new Error("平博官网登录账号不一致：页面 aaa，绑定 bbb"))).toBe(false);
  });
});

describe("isPbLiveTabDead", () => {
  test("null / empty / miss fallback; axios payload stays live", () => {
    expect(isPbLiveTabDead(undefined)).toBe(true);
    expect(isPbLiveTabDead(null)).toBe(true);
    expect(isPbLiveTabDead({})).toBe(true);
    expect(isPbLiveTabDead("PB live tab host mismatch")).toBe(true);
    expect(isPbLiveTabDead({ data: { success: true } })).toBe(false);
    expect(isPbLiveTabDead("Request failed with status code 403")).toBe(false);
  });
});

describe("pbLiveTabHardError", () => {
  test("venue 403 string becomes Error; miss stays undefined", () => {
    expect(pbLiveTabHardError("Request failed with status code 403")?.message)
      .toBe("Request failed with status code 403");
    expect(pbLiveTabHardError("平博官网登录账号不一致：页面 aaa，绑定 bbb")?.message)
      .toContain("登录账号不一致");
    expect(pbLiveTabHardError("PB live tab host mismatch")).toBeUndefined();
    expect(pbLiveTabHardError({ data: { success: true } })).toBeUndefined();
  });
});
