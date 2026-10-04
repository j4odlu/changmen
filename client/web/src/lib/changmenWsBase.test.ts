import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChangmenWsBase } from "@changmen/venue-adapter/shared";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("development authenticated realtime routing", () => {
  it("keeps Cookie websocket requests on the API host for any configured dev port", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_API_BASE", "");
    vi.stubEnv("VITE_WEB_COOKIE_AUTH", "1");
    vi.stubGlobal("window", { location: { origin: "http://localhost:6100" } });
    expect(resolveChangmenWsBase()).toBe("http://localhost:6100");
  });
  it("honors an explicit API origin", () => {
    vi.stubEnv("VITE_API_BASE", "https://api.changmen.fun/");
    vi.stubGlobal("window", { location: { origin: "https://changmen.fun" } });
    expect(resolveChangmenWsBase()).toBe("https://api.changmen.fun");
  });
});
