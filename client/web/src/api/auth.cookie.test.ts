import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), probe: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/authLock", () => ({ withAuthLock: (fn: () => unknown) => fn() }));
vi.mock("@/lib/webSession", () => ({ probeCookieSession: mocks.probe, stopWebSessionWatch: mocks.stop }));
import { advanceAuthSessionVersion, browserAuthState, clearAuthSession, getCookieSessionInfo, getToken, isCookieAuthMode, setCookieSessionInfo, setToken, usesWebCookieSession } from "@/api/client";
import { login, logout } from "./auth";
beforeEach(() => {
  clearAuthSession(); vi.clearAllMocks(); vi.stubEnv("VITE_WEB_COOKIE_AUTH", "1"); vi.stubGlobal("fetch", mocks.fetch);
  mocks.probe.mockImplementation(async () => {
    setCookieSessionInfo({ user: { id: "u", userName: "river", role: "user" }, browserSessionId: "browser", loginEpoch: "epoch", cookieEnabled: true, csrfToken: "csrf" });
    return true;
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearAuthSession(); });
describe("native Cookie login", () => {
  it("does not load, save or send application JWTs in Cookie-only builds", async () => {
    const { authHeaders, getRefreshToken, setRefreshToken } = await import("@/lib/authSession");
    localStorage.setItem("app:token", "legacy");
    localStorage.setItem("app:refresh-token", "legacy-refresh");
    setToken("legacy");
    setRefreshToken("legacy-refresh");
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(localStorage.getItem("app:token")).toBeNull();
    expect(localStorage.getItem("app:refresh-token")).toBeNull();
    expect(authHeaders()).toEqual({ "X-Changmen-Auth": "cookie" });
  });
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
  it("invalidates old credentials after a lost native login response without replay", async () => {
    setToken("previous-user-token");
    mocks.fetch.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(login("river", "password")).rejects.toThrow("登录结果尚未确认");
    expect(getToken()).toBeNull();
    expect(isCookieAuthMode()).toBe(true);
    expect(browserAuthState.value).toBe("unavailable");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("bounds logout confirmation and preserves retryable identity when the response is lost", async () => {
    await mocks.probe();
    mocks.fetch.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(logout()).rejects.toThrow("退出尚未确认");
    expect(usesWebCookieSession()).toBe(true);
    expect(browserAuthState.value).toBe("unavailable");
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("clears identity after confirmed server revocation", async () => {
    await mocks.probe();
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    expect(await logout()).toBe(true);
    expect(getCookieSessionInfo()).toBeNull();
    expect(mocks.fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", headers: { "X-CSRF-Token": "csrf" }, body: JSON.stringify({ expectedBrowserSessionId: "browser", expectedLoginEpoch: "epoch" }) });
  });
  it("accepts an already revoked session as confirmed logout", async () => {
    await mocks.probe();
    mocks.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: "SESSION_REVOKED" }) });
    expect(await logout()).toBe(true);
    expect(getCookieSessionInfo()).toBeNull();
  });
  it("finishes logout when its initial recovery probe already confirms no session", async () => {
    mocks.probe.mockImplementationOnce(async () => { clearAuthSession(); return false; });
    expect(await logout()).toBe(true);
    expect(getCookieSessionInfo()).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("does not treat HTTP success without revocation confirmation as logout", async () => {
    await mocks.probe();
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: false }) });
    await expect(logout()).rejects.toThrow("退出尚未确认");
    expect(getCookieSessionInfo()?.browserSessionId).toBe("browser");
  });
  it("does not clear a new login when an old logout response arrives", async () => {
    await mocks.probe();
    let release!: (value: unknown) => void;
    let started!: () => void;
    const sent = new Promise<void>(resolve => { started = resolve; });
    mocks.fetch.mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const task = logout();
    await sent;
    advanceAuthSessionVersion();
    setCookieSessionInfo({ user: { id: "new", userName: "new", role: "user" }, browserSessionId: "new", loginEpoch: "new", cookieEnabled: true, csrfToken: "new" });
    release({ ok: true, status: 200, json: async () => ({ ok: true }) });
    expect(await task).toBe(false);
    expect(getCookieSessionInfo()?.user.id).toBe("new");
  });
});
