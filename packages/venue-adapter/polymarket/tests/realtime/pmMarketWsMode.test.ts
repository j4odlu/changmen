import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  cyclePmMarketWsSourceMode,
  getPmMarketWsSourceMode,
  pmMarketWsSourceModeLabel,
  resetPmMarketWsSourceModeForTests,
  setPmMarketWsSourceMode,
} from "../../pmMarketWsMode";

describe("pmMarketWsMode", () => {
  beforeEach(() => {
    resetPmMarketWsSourceModeForTests("changmen");
  });

  test("defaults to changmen", () => {
    expect(getPmMarketWsSourceMode()).toBe("changmen");
    expect(pmMarketWsSourceModeLabel()).toBe("CHANGMEN 转发");
  });

  test("cycles changmen → official → changmen", () => {
    expect(cyclePmMarketWsSourceMode()).toBe("official");
    expect(pmMarketWsSourceModeLabel()).toBe("官方源");
    expect(cyclePmMarketWsSourceMode()).toBe("changmen");
  });

  test("persists to localStorage", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });

    setPmMarketWsSourceMode("official");
    expect(storage.get("changmen:pm:market-ws-source-mode")).toBe("official");

    resetPmMarketWsSourceModeForTests("changmen");
    expect(getPmMarketWsSourceMode()).toBe("changmen");
  });
});
