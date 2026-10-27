import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map();

vi.mock("@changmen/storage/json_file_store", () => ({
  readJsonFile: (name, fallback) => (mem.has(name) ? mem.get(name) : fallback),
  writeJsonFile: (name, data) => {
    mem.set(name, data);
  },
}));

describe("market_hub_route", () => {
  beforeEach(() => {
    mem.clear();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("defaults: everyone → ws (202)", async () => {
    const mod = await import("./market_hub_route.js");
    expect(mod.resolveMarketHubOriginForUser("GB11")).toBe("https://ws.changmen.fun");
    expect(mod.resolveMarketHubOriginForUser("gb15")).toBe("https://ws.changmen.fun");
    expect(mod.resolveMarketHubOriginForUser("gb16")).toBe("https://ws.changmen.fun");
    expect(mod.resolveMarketHubOriginForUser("")).toBe("https://ws.changmen.fun");
  });

  it("env list without file still defaults everyone to ws", async () => {
    vi.stubEnv("MARKET_HUB_PRIMARY_USERS", "alice, Bob");
    const mod = await import("./market_hub_route.js");
    expect(mod.resolveMarketHubOriginForUser("alice")).toBe("https://ws.changmen.fun");
    expect(mod.resolveMarketHubOriginForUser("bob")).toBe("https://ws.changmen.fun");
    expect(mod.resolveMarketHubOriginForUser("gb11")).toBe("https://ws.changmen.fun");
  });

  it("empty primaryUsers + defaultHub secondary still sends everyone to ws", async () => {
    const mod = await import("./market_hub_route.js");
    mod.saveMarketHubRouteConfig({ primaryUsers: [], defaultHub: "secondary" });
    expect(mod.getMarketHubRouteConfig().primaryUsers).toEqual([]);
    expect(mod.resolveMarketHubOriginForUser("gb11")).toBe("https://ws.changmen.fun");
  });

  it("rejects non-allowlisted origin", async () => {
    const mod = await import("./market_hub_route.js");
    expect(() => mod.saveMarketHubRouteConfig({
      primaryOrigin: "https://evil.example",
    })).toThrow(/非法/);
    expect(() => mod.saveMarketHubRouteConfig({
      secondaryOrigin: "https://hub-secondary.example",
    })).toThrow(/非法/);
    expect(mod.normalizeMarketHubOrigin("http://ws.changmen.fun")).toBeNull();
    expect(mod.normalizeMarketHubOrigin("https://ws.changmen.fun/")).toBe("https://ws.changmen.fun");
    expect(mod.normalizeMarketHubOrigin("https://hub-secondary.example")).toBeNull();
  });

  it("file overrides env", async () => {
    vi.stubEnv("MARKET_HUB_PRIMARY_USERS", "alice");
    const mod = await import("./market_hub_route.js");
    mod.saveMarketHubRouteConfig({ primaryUsers: ["carol"], defaultHub: "secondary" });
    expect(mod.resolveMarketHubOriginForUser("carol")).toBe("https://ws.changmen.fun");
    expect(mod.resolveMarketHubOriginForUser("alice")).toBe("https://ws.changmen.fun");
  });
});
