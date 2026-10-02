import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), probe: vi.fn() }));
vi.mock("@/lib/authLock", () => ({ withAuthLock: (fn: () => unknown) => fn() }));
vi.mock("@/lib/webSession", () => ({ probeCookieSession: mocks.probe }));
import { browserAuthState, clearAuthSession, getToken, isCookieAuthMode, setCookieSessionInfo, setToken, usesWebCookieSession } from "@/api/client";
import { login } from "./auth";
beforeEach(() => {
  clearAuthSession(); vi.clearAllMocks(); vi.stubEnv("VITE_WEB_COOKIE_AUTH", "1"); vi.stubGlobal("fetch", mocks.fetch);
  mocks.probe.mockImplementation(async () => {
    setCookieSessionInfo({ user: { id: "u", userName: "river", role: "user" }, browserSessionId: "browser", loginEpoch: "epoch", cookieEnabled: true, csrfToken: "csrf" });
    return true;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearAuthSession(); });
describe("native Cookie login", () => {
  it("accepts a login without JWT and confirms the Cookie identity", async () => {
    setToken("previous-user-token");
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: 1, info: { ID: "u", userName: "river", sessionMode: "cookie" } }) });
    expect(await login("river", "password")).toHaveProperty("userName", "river");
    expect(getToken()).toBeNull();
    expect(usesWebCookieSession()).toBe(true);
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", headers: { "X-Changmen-Auth": "cookie" } });
  });
  it("preserves the committed Cookie hint and never replays an uncertain login", async () => {
    setToken("old-token");
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ success: 0, code: "LOGIN_RESULT_UNCERTAIN", msg: "登录已提交，请刷新页面确认" }) });
    await expect(login("river", "password")).rejects.toThrow("登录已提交");
    expect(getToken()).toBeNull();
    expect(isCookieAuthMode()).toBe(true);
    expect(browserAuthState.value).toBe("unavailable");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.probe).not.toHaveBeenCalled();
  });
});
