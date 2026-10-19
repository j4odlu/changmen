import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePfHttpMode, setPfHttpMode, setPfHttpModeForTests } from "./pfTransportMode";
import {
  getPfMarketWsSourceMode,
  resetPfMarketWsSourceModeForTests,
  setPfMarketWsSourceMode,
} from "./pfMarketWsMode";
import { resolvePredictFunMarketWsUrl, PREDICT_FUN_WS_FORWARD_PATH } from "./wsConfig";
import { PREDICT_FUN_WS } from "./api";

describe("pfTransportMode + wsConfig", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });
    setPfHttpModeForTests(null);
    resetPfMarketWsSourceModeForTests("changmen");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setPfHttpModeForTests(null);
  });

  it("defaults HTTP mode to vps", () => {
    expect(resolvePfHttpMode()).toBe("vps");
  });

  it("persists HTTP mode to localStorage", () => {
    setPfHttpMode("direct");
    expect(resolvePfHttpMode()).toBe("direct");
  });

  it("resolves changmen WS path by default", () => {
    expect(resolvePredictFunMarketWsUrl()).toContain(PREDICT_FUN_WS_FORWARD_PATH);
  });

  it("resolves official WS when mode is official", () => {
    setPfMarketWsSourceMode("official");
    expect(getPfMarketWsSourceMode()).toBe("official");
    expect(resolvePredictFunMarketWsUrl().startsWith(PREDICT_FUN_WS)).toBe(true);
  });
});
