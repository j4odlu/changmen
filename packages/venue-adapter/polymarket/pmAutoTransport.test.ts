import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPmAutoTransportOnLogin,
  markPmTransportManualOverride,
  resetPmTransportManualOverrideForTests,
  syncPmHttpModeWithMarketWs,
} from "./pmAutoTransport";
import { resetPmRoutingPreferenceForTests, setPmRoutingPreference } from "./pmRoutingPreference";
import { resetPmMarketWsSourceModeForTests, getPmMarketWsSourceMode, setPmMarketWsSourceMode } from "./pmMarketWsMode";
import { resetPmUserWsSourceModeForTests, getPmUserWsSourceMode } from "./pmUserWsMode";
import { setPmHttpModeForTests, resolvePmHttpMode, setPmHttpMode } from "./pmTransportMode";
import * as reachability from "./pmOfficialReachability";
import { getPmOrderSubmitMode, resolvePmOrderSubmitHttpMode, setPmOrderSubmitMode } from "./pmOrderSubmitMode";

vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({
  probeGamebetExtension: vi.fn(async () => null),
  a8PluginGet: vi.fn(),
}));

import { probeGamebetExtension } from "@changmen/client-core/chrome-plugin/bridge";

describe("pmAutoTransport", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });
    resetPmTransportManualOverrideForTests();
    resetPmRoutingPreferenceForTests();
    resetPmMarketWsSourceModeForTests("changmen");
    resetPmUserWsSourceModeForTests("changmen");
    setPmHttpModeForTests(null);
    vi.mocked(probeGamebetExtension).mockReset();
    vi.restoreAllMocks();
    vi.mocked(probeGamebetExtension).mockResolvedValue(null);
    vi.spyOn(reachability, "probePolymarketClobViaExtension").mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses official WS + vps HTTP even when plugin CLOB probe would succeed", async () => {
    vi.spyOn(reachability, "probePolymarketOfficialReachable").mockResolvedValue({
      reachable: true,
      httpOk: true,
      marketWsOk: true,
    });
    vi.mocked(probeGamebetExtension).mockResolvedValue({
      name: "gamebet",
      version: "1.0.0",
      extensionId: "test-ext",
    });
    vi.mocked(reachability.probePolymarketClobViaExtension).mockResolvedValue(true);

    const result = await applyPmAutoTransportOnLogin();
    expect(result.applied).toBe(true);
    expect(result.httpMode).toBe("vps");
    expect(getPmMarketWsSourceMode()).toBe("official");
    expect(getPmUserWsSourceMode()).toBe("official");
    expect(resolvePmHttpMode()).toBe("vps");
    expect(probeGamebetExtension).not.toHaveBeenCalled();
    expect(reachability.probePolymarketClobViaExtension).not.toHaveBeenCalled();
  });

  it("uses official WS and vps HTTP when plugin exists but CLOB probe fails", async () => {
    vi.spyOn(reachability, "probePolymarketOfficialReachable").mockResolvedValue({
      reachable: true,
      httpOk: false,
      marketWsOk: true,
    });
    vi.mocked(probeGamebetExtension).mockResolvedValue({
      name: "gamebet",
      version: "1.0.0",
      extensionId: "test-ext",
    });
    vi.mocked(reachability.probePolymarketClobViaExtension).mockResolvedValue(false);

    const result = await applyPmAutoTransportOnLogin();
    expect(result.marketWsMode).toBe("official");
    expect(result.httpMode).toBe("vps");
    expect(resolvePmHttpMode()).toBe("vps");
  });

  it("uses official WS and vps HTTP when plugin is missing", async () => {
    vi.spyOn(reachability, "probePolymarketOfficialReachable").mockResolvedValue({
      reachable: true,
      httpOk: false,
      marketWsOk: true,
    });
    vi.mocked(probeGamebetExtension).mockResolvedValue(null);

    const result = await applyPmAutoTransportOnLogin();
    expect(result.marketWsMode).toBe("official");
    expect(result.httpMode).toBe("vps");
  });

  it("falls back to changmen/vps when probe fails", async () => {
    vi.spyOn(reachability, "probePolymarketOfficialReachable").mockResolvedValue({
      reachable: false,
      httpOk: false,
      marketWsOk: false,
    });

    const result = await applyPmAutoTransportOnLogin();
    expect(result.applied).toBe(true);
    expect(result.httpMode).toBe("vps");
    expect(getPmMarketWsSourceMode()).toBe("changmen");
    expect(getPmUserWsSourceMode()).toBe("changmen");
    expect(resolvePmHttpMode()).toBe("vps");
  });

  it.each(["auto", "official", "relay"] as const)("preserves local order preference across login and %s query routing", async preference => {
    setPmOrderSubmitMode("local");
    setPmRoutingPreference(preference);
    vi.spyOn(reachability, "probePolymarketOfficialReachable").mockResolvedValue({ reachable: false, httpOk: false, marketWsOk: false });
    await applyPmAutoTransportOnLogin();
    expect(resolvePmHttpMode()).toBe("vps");
    expect(getPmOrderSubmitMode()).toBe("local");
    expect(resolvePmOrderSubmitHttpMode()).toBe("direct");
  });

  it("uses forced relay preference without probing official", async () => {
    setPmRoutingPreference("relay");
    const probe = vi.spyOn(reachability, "probePolymarketOfficialReachable");

    const result = await applyPmAutoTransportOnLogin();
    expect(result.skippedManualOverride).toBe(true);
    expect(result.routingPreference).toBe("relay");
    expect(probe).not.toHaveBeenCalled();
    expect(getPmMarketWsSourceMode()).toBe("changmen");
    expect(getPmUserWsSourceMode()).toBe("changmen");
    expect(resolvePmHttpMode()).toBe("vps");
  });

  it("uses forced official preference without probing official", async () => {
    setPmRoutingPreference("official");
    const probe = vi.spyOn(reachability, "probePolymarketOfficialReachable");

    const result = await applyPmAutoTransportOnLogin();
    expect(result.skippedManualOverride).toBe(true);
    expect(result.routingPreference).toBe("official");
    expect(probe).not.toHaveBeenCalled();
    expect(getPmMarketWsSourceMode()).toBe("official");
    expect(getPmUserWsSourceMode()).toBe("official");
    expect(resolvePmHttpMode()).toBe("vps");
  });

  it("ignores legacy manual override when routing preference is auto", async () => {
    setPmMarketWsSourceMode("changmen");
    setPmHttpMode("extension");
    markPmTransportManualOverride();
    const probe = vi.spyOn(reachability, "probePolymarketOfficialReachable").mockResolvedValue({
      reachable: true,
      httpOk: true,
      marketWsOk: true,
    });

    const result = await applyPmAutoTransportOnLogin();
    expect(result.applied).toBe(true);
    expect(result.skippedManualOverride).toBe(false);
    expect(result.routingPreference).toBe("auto");
    expect(probe).toHaveBeenCalledOnce();
    expect(getPmMarketWsSourceMode()).toBe("official");
    expect(getPmUserWsSourceMode()).toBe("official");
    expect(resolvePmHttpMode()).toBe("vps");
  });

  it("syncPmHttpModeWithMarketWs forces vps for changmen WS", async () => {
    setPmHttpMode("extension");
    const mode = await syncPmHttpModeWithMarketWs("changmen");
    expect(mode).toBe("vps");
    expect(resolvePmHttpMode()).toBe("vps");
  });

  it("syncPmHttpModeWithMarketWs to official uses extension when plugin CLOB probe succeeds", async () => {
    vi.mocked(probeGamebetExtension).mockResolvedValue({
      name: "gamebet",
      version: "1.0.0",
      extensionId: "test-ext",
    });
    vi.mocked(reachability.probePolymarketClobViaExtension).mockResolvedValue(true);

    const mode = await syncPmHttpModeWithMarketWs("official");
    expect(mode).toBe("extension");
    expect(resolvePmHttpMode()).toBe("extension");
  });
});
