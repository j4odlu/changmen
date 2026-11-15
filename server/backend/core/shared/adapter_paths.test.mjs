import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  adapterRequire,
  getAdapterRoot,
  initAdapterRegistry,
  reqS,
  requirePlatform,
} from "./adapter_paths.js";

beforeAll(async () => {
  await initAdapterRegistry();
});

describe("adapter_paths", () => {
  it("resolves platform_adapter with manifest.json", () => {
    const root = getAdapterRoot();
    expect(fs.existsSync(path.join(root, "registry", "manifest.json"))).toBe(true);
  });

  it("adapterRequire loads registry manifest", () => {
    const root = getAdapterRoot();
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(root, "registry", "manifest.json"), "utf8"),
    );
    const { MANIFEST } = adapterRequire("registry", "paths.js");
    expect(MANIFEST).toHaveLength(onDisk.length);
    expect(MANIFEST.length).toBeGreaterThan(0);
  });

  it("feeds.isVpsOwnedPlatformCollect follows manifest collectionMode", () => {
    const { isVpsOwnedPlatformCollect } = adapterRequire("registry", "feeds.js");
    expect(isVpsOwnedPlatformCollect("PredictFun")).toBe(true);
    expect(isVpsOwnedPlatformCollect("Polymarket")).toBe(true);
    expect(isVpsOwnedPlatformCollect("OB")).toBe(false);
  });

  it("reqS loads @changmen/shared modules", async () => {
    const { getDefaultMarketCode } = await import("@changmen/shared/catalog/market_catalog");
    expect(typeof getDefaultMarketCode).toBe("function");
    expect(getDefaultMarketCode("OB")).toBeTruthy();
  });

  it("requirePlatform loads OB session module (ESM backend)", () => {
    const { obGet } = requirePlatform("OB", "node", "session.js");
    expect(typeof obGet).toBe("function");
  });

  it("requirePlatform loads RAY session module (ESM backend)", () => {
    const { login, rayGet } = requirePlatform("RAY", "node", "session.js");
    expect(typeof login).toBe("function");
    expect(typeof rayGet).toBe("function");
  });

  it("requirePlatform loads TF session module (ESM backend)", () => {
    const { tfGet, tryLoadSession } = requirePlatform("TF", "node", "session.js");
    expect(typeof tfGet).toBe("function");
    expect(typeof tryLoadSession).toBe("function");
  });

  it("requirePlatform loads TF collect_credentials (local only)", async () => {
    const { getTfA8CollectCredentials } = requirePlatform("TF", "node", "collect_credentials.js");
    expect(typeof getTfA8CollectCredentials).toBe("function");
    try {
      const creds = await getTfA8CollectCredentials();
      expect(creds.provider).toBe("TF");
      expect(creds.gateway).toBeTruthy();
      expect(creds.token).toBeTruthy();
    }
    catch (err) {
      expect(String(err.message || err)).toMatch(/TF 采集凭证未配置/);
    }
  });

  it("does not load the optional IA HTTP probe through the runtime loader", () => {
    expect(() => requirePlatform("IA", "node", "session.js")).toThrow();
  });

  it("requirePlatform loads IA collect_credentials (ESM backend)", () => {
    const { getIaA8CollectCredentials } = requirePlatform("IA", "node", "collect_credentials.js");
    const creds = getIaA8CollectCredentials();
    expect(creds.provider).toBe("IA");
    expect(creds.gateway).toBe("https://pc.ilustre-analytics.org");
  });

  it("requirePlatform loads PB session module (ESM backend)", () => {
    const { tryLoadSession, buildAuthHeaders, parsePbTokenBalance } = requirePlatform(
      "PB",
      "node",
      "session.js",
    );
    expect(typeof tryLoadSession).toBe("function");
    expect(typeof buildAuthHeaders).toBe("function");
    expect(typeof parsePbTokenBalance).toBe("function");
  });

  it("does not load the optional PB parser through the runtime loader", () => {
    expect(() => requirePlatform("PB", "node", "core.js")).toThrow();
  });
});
