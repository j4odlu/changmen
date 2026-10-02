import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ token: "legacy", cookie: false, version: "one", state: { value: "authenticated" }, refresh: vi.fn() }));
vi.mock("@/lib/authSession", () => ({
  authHeaders: () => ({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" }),
  browserAuthState: mock.state, getAuthSessionVersion: () => mock.version,
  getToken: () => mock.token, isAuthSessionCurrent: (version: string) => version === mock.version,
  usesWebCookieSession: () => mock.cookie,
}));
vi.mock("@/config/apiBase", () => ({ getApiBase: () => "https://api.changmen.fun" }));
vi.mock("@/lib/jwtRefresh", () => ({ refreshJwtSession: mock.refresh }));
import { createCompatibilityTokenProvider, getCompatibilityToken, getRequestAuthHeaders } from "./authCredentials";
beforeEach(() => {
  mock.token = "legacy"; mock.cookie = true; mock.version = "one"; mock.state.value = "authenticated";
  mock.refresh.mockReset(); vi.stubGlobal("window", { location: { origin: "https://changmen.fun" } });
});
afterEach(() => vi.unstubAllGlobals());
describe("request credential selection", () => {
  it("uses Cookie/CSRF for the backend without refreshing JWT", async () => {
    expect(await getRequestAuthHeaders("https://api.changmen.fun/esport/Pm_HttpRequest")).toEqual({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" });
    expect(mock.refresh).not.toHaveBeenCalled();
  });
  it("uses compatibility JWT for external relays without exposing CSRF", async () => {
    expect(await getRequestAuthHeaders("https://relay.example/esport/http-relay")).toEqual({ token: "legacy" });
  });
  it("refreshes an expired credential before admission without replaying the operation", async () => {
    mock.token = `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`;
    mock.refresh.mockImplementation(async () => { mock.token = "fresh"; return true; });
    expect(await getCompatibilityToken()).toBe("fresh");
    expect(mock.refresh).toHaveBeenCalledTimes(1);
  });
  it("does not return a new user's credential to an old caller", async () => {
    mock.token = "";
    mock.refresh.mockImplementation(async () => { mock.version = "two"; mock.token = "new-user"; return true; });
    await expect(getCompatibilityToken()).rejects.toThrow("登录状态已变更");
  });
  it("blocks admission while preserving credentials during outages", async () => {
    mock.state.value = "unavailable";
    await expect(getRequestAuthHeaders("https://api.changmen.fun/esport/Client_GetData")).rejects.toThrow("暂时不可用");
    expect(mock.token).toBe("legacy");
  });
  it("refreshes credentials for a later signing call in the same operation", async () => {
    const provider = createCompatibilityTokenProvider();
    expect(await provider()).toBe("legacy");
    mock.token = `header.${btoa(JSON.stringify({ exp: 1 }))}.signature`;
    mock.refresh.mockImplementation(async () => { mock.token = "renewed"; return true; });
    expect(await provider()).toBe("renewed");
  });
  it("rejects later signing calls after logout or a different login", async () => {
    const provider = createCompatibilityTokenProvider();
    mock.version = "two";
    mock.token = "new-user";
    await expect(provider()).rejects.toThrow("重新开始操作");
    expect(mock.refresh).not.toHaveBeenCalled();
  });
});
