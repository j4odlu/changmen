import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  cyclePmUserWsSourceMode,
  getPmUserWsSourceMode,
  pmUserWsSourceModeLabel,
  resetPmUserWsSourceModeForTests,
  setPmUserWsSourceMode,
} from "@changmen/venue-browser/polymarket/pmUserWsMode";

describe("pmUserWsMode", () => {
  beforeEach(() => {
    resetPmUserWsSourceModeForTests("changmen");
  });

  test("defaults to changmen", () => {
    expect(getPmUserWsSourceMode()).toBe("changmen");
    expect(pmUserWsSourceModeLabel()).toBe("CHANGMEN 转发");
  });

  test("cycles changmen → official → changmen", () => {
    expect(cyclePmUserWsSourceMode()).toBe("official");
    expect(pmUserWsSourceModeLabel()).toBe("官方源");
    expect(cyclePmUserWsSourceMode()).toBe("changmen");
  });

  test("persists to localStorage", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });

    setPmUserWsSourceMode("official");
    expect(storage.get("changmen:pm:user-ws-source-mode")).toBe("official");

    resetPmUserWsSourceModeForTests("changmen");
    expect(getPmUserWsSourceMode()).toBe("changmen");
  });
});
