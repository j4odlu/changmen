import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPfAutoTransportOnLogin,
  markPfTransportManualOverride,
  resetPfTransportManualOverrideForTests,
} from "./pfAutoTransport";
import { getPfMarketWsSourceMode, resetPfMarketWsSourceModeForTests } from "./pfMarketWsMode";
import { resolvePfHttpMode, setPfHttpModeForTests } from "./pfTransportMode";
import * as reachability from "./pfOfficialReachability";
import * as transport from "./transport";

describe("pfAutoTransport", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });
    resetPfTransportManualOverrideForTests();
    resetPfMarketWsSourceModeForTests("changmen");
    setPfHttpModeForTests(null);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses official WS + direct HTTP when market WS probe succeeds and browser has API key", async () => {
    vi.spyOn(transport, "resolvePredictFunApiKey").mockReturnValue("test-key");
    vi.spyOn(reachability, "probePredictFunOfficialReachable").mockResolvedValue({
      reachable: true,
      httpOk: true,
      marketWsOk: true,
    });

    const result = await applyPfAutoTransportOnLogin();
    expect(result.applied).toBe(true);
    expect(result.httpMode).toBe("direct");
    expect(getPfMarketWsSourceMode()).toBe("official");
    expect(resolvePfHttpMode()).toBe("direct");
  });

  it("keeps official WS but forces vps HTTP when WS ok and browser lacks API key", async () => {
    vi.spyOn(transport, "resolvePredictFunApiKey").mockReturnValue("");
    vi.spyOn(reachability, "probePredictFunOfficialReachable").mockResolvedValue({
      reachable: true,
      httpOk: false,
      marketWsOk: true,
    });

    const result = await applyPfAutoTransportOnLogin();
    expect(result.applied).toBe(true);
    expect(result.httpMode).toBe("vps");
    expect(getPfMarketWsSourceMode()).toBe("official");
    expect(resolvePfHttpMode()).toBe("vps");
  });

  it("falls back to changmen/vps when probe fails", async () => {
    vi.spyOn(reachability, "probePredictFunOfficialReachable").mockResolvedValue({
      reachable: false,
      httpOk: false,
      marketWsOk: false,
    });

    const result = await applyPfAutoTransportOnLogin();
    expect(result.applied).toBe(true);
    expect(result.httpMode).toBe("vps");
    expect(getPfMarketWsSourceMode()).toBe("changmen");
    expect(resolvePfHttpMode()).toBe("vps");
  });

  it("skips auto routing after manual override", async () => {
    markPfTransportManualOverride();
    const probe = vi.spyOn(reachability, "probePredictFunOfficialReachable");

    const result = await applyPfAutoTransportOnLogin();
    expect(result.skippedManualOverride).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });
});
