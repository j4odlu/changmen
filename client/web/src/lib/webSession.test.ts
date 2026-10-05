import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceAuthSessionVersion, beginAuthTransition, browserAuthState, clearAuthSession, getCookieSessionInfo, hasAuthSession, setCookieAuthMode, setCookieSessionInfo } from "@/api/client";
import { probeCookieSession, renewPersistentCookieSession, startWebSessionWatch, stopWebSessionWatch } from "./webSession";
const locks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/authLock", () => ({ withAuthLock: locks.run }));
vi.mock("@/lib/jwtRefresh", () => ({ stopJwtAutoRefresh: vi.fn(), startJwtAutoRefresh: vi.fn(), refreshJwtSession: async () => true }));
vi.mock("@changmen/venue-adapter/shared", async (importOriginal) => ({
  ...await importOriginal<typeof import("@changmen/venue-adapter/shared")>(),
  resolveChangmenWsBase: () => "https://changmen.fun",
}));
const info = { user: { id: "u", userName: "river", role: "user" }, browserSessionId: "bs", loginEpoch: "epoch", cookieEnabled: true, csrfToken: "csrf" };
const fetchMock = vi.fn();
function response(data: unknown, status = 200) { return { status, ok: status < 400, json: async () => data }; }
beforeEach(() => {
  clearAuthSession(); setCookieAuthMode(true); fetchMock.mockReset();
  locks.run.mockReset().mockImplementation((fn: () => unknown) => fn());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { origin: "https://changmen.fun", href: "/", reload: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { stopWebSessionWatch(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("browser session recovery", () => {
  it.each([{}, { code: "TEMPORARY_UNAVAILABLE" }, { code: "COOKIE_LOGIN_REQUIRED" }])("preserves the session on an unconfirmed HTTP 401: %s", async (data) => {
    setCookieSessionInfo(info);
    fetchMock.mockResolvedValue(response(data, 401));
    await expect(probeCookieSession()).rejects.toThrow();
    expect(getCookieSessionInfo()?.loginEpoch).toBe("epoch");
    expect(browserAuthState.value).toBe("unavailable");
  });
  it("discards a revoked response body that arrives after a new login", async () => {
    setCookieSessionInfo(info);
    let release!: (value: unknown) => void;
    fetchMock.mockResolvedValue({ status: 401, ok: false, json: () => new Promise(resolve => { release = resolve; }) });
    const pending = probeCookieSession();
    await vi.waitFor(() => expect(release).toBeDefined());
    advanceAuthSessionVersion();
    setCookieSessionInfo({ ...info, loginEpoch: "new-login" });
    release({ code: "SESSION_REVOKED" });
    expect(await pending).toBe(false);
    expect(getCookieSessionInfo()?.loginEpoch).toBe("new-login");
  });
  it("rebuilds page state when the shared API Cookie changes identity outside this page origin", async () => {
    setCookieSessionInfo(info);
    fetchMock.mockResolvedValue(response({ ...info, user: { ...info.user, id: "other" }, browserSessionId: "other-browser", loginEpoch: "other-login" }));
    expect(await probeCookieSession()).toBe(false);
    expect(getCookieSessionInfo()).toBeNull();
    expect(window.location.reload).toHaveBeenCalledOnce();
  });
  it("renews a persistent Cookie once daily under the login/logout lock", async () => {
    vi.useFakeTimers();
    setCookieSessionInfo({ ...info, persistent: true });
    fetchMock.mockResolvedValue(response({ ok: true }));
    await renewPersistentCookieSession();
    expect(locks.run).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("/auth/session/renew");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedBrowserSessionId: "bs", expectedLoginEpoch: "epoch" });
    await renewPersistentCookieSession();
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await renewPersistentCookieSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("cancels a queued Cookie write if another login completes before the lock is acquired", async () => {
    setCookieSessionInfo({ ...info, persistent: true });
    locks.run.mockImplementation(async (fn: () => unknown) => { advanceAuthSessionVersion(); return fn(); });
    await renewPersistentCookieSession();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retries failed Cookie renewal without clearing the identity", async () => {
    setCookieSessionInfo({ ...info, persistent: true });
    fetchMock.mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response({ ok: true }));
    await expect(renewPersistentCookieSession()).rejects.toThrow();
    expect(getCookieSessionInfo()?.loginEpoch).toBe("epoch");
    await renewPersistentCookieSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("clears a stale Cookie mode after 401 on the first probe after reload", async () => {
    expect(getCookieSessionInfo()).toBeNull();
    expect(hasAuthSession()).toBe(true);
    fetchMock.mockResolvedValue(response({ code: "SESSION_REVOKED" }, 401));
    expect(await probeCookieSession()).toBe(false);
    expect(hasAuthSession()).toBe(false);
    expect(browserAuthState.value).toBe("anonymous");
  });
  it("does not clear Cookie mode while a new login is being submitted", async () => {
    const finish = beginAuthTransition();
    try {
      fetchMock.mockResolvedValue(response({}, 401));
      expect(await probeCookieSession()).toBe(false);
      expect(hasAuthSession()).toBe(true);
    }
    finally { finish(); }
  });
  it("keeps the Cookie mode on a temporary failure before identity is restored", async () => {
    fetchMock.mockResolvedValue(response({}, 503));
    await expect(probeCookieSession()).rejects.toThrow();
    expect(hasAuthSession()).toBe(true);
    expect(browserAuthState.value).toBe("unavailable");
  });
  it("restores a Cookie identity without an access JWT", async () => {
    fetchMock.mockResolvedValue(response(info));
    expect(await probeCookieSession(false)).toBe(true);
    expect(getCookieSessionInfo()?.user.id).toBe("u");
    expect(browserAuthState.value).toBe("authenticated");
  });
  it("preserves identity but blocks admission on temporary failure", async () => {
    setCookieSessionInfo(info);
    fetchMock.mockResolvedValue(response({}, 503));
    await expect(probeCookieSession(false)).rejects.toThrow();
    expect(getCookieSessionInfo()?.user.id).toBe("u");
    expect(browserAuthState.value).toBe("unavailable");
  });
  it("never changes transport under an existing Cookie session", async () => {
    setCookieSessionInfo(info);
    fetchMock.mockResolvedValue(response({ ...info, cookieEnabled: false }));
    await expect(probeCookieSession()).rejects.toThrow("配置已变更");
    expect(getCookieSessionInfo()?.loginEpoch).toBe("epoch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(browserAuthState.value).toBe("unavailable");
  });
  it("does not overwrite a new login with an old in-flight session probe", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementation(() => new Promise(r => { resolve = r; }));
    const task = probeCookieSession(false);
    advanceAuthSessionVersion();
    resolve(response(info));
    expect(await task).toBe(false);
    expect(getCookieSessionInfo()).toBeNull();
  });
  it("starts a separate probe for a new login while the old probe is pending", async () => {
    let release!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce(response({ ...info, browserSessionId: "new-browser", loginEpoch: "new-epoch" }));
    const old = probeCookieSession();
    advanceAuthSessionVersion();
    expect(await probeCookieSession()).toBe(true);
    release(response(info));
    expect(await old).toBe(false);
    expect(getCookieSessionInfo()?.loginEpoch).toBe("new-epoch");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not interpret a missing compatibility route as a fallback of an existing Cookie session", async () => {
    setCookieSessionInfo(info);
    fetchMock.mockResolvedValue(response({}, 404));
    await expect(probeCookieSession(false)).rejects.toThrow();
    expect(getCookieSessionInfo()?.cookieEnabled).toBe(true);
    expect(browserAuthState.value).toBe("unavailable");
  });
  it("stops automatic retries after a Cookie configuration error", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_WEB_COOKIE_AUTH", "1");
    fetchMock.mockResolvedValue(response({}, 404));
    startWebSessionWatch();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.removeEventListener).toHaveBeenCalledWith("focus", expect.any(Function));
    await vi.advanceTimersByTimeAsync(180000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("continues retrying temporary service errors", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(response({}, 503));
    startWebSessionWatch();
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(browserAuthState.value).toBe("unavailable");
  });
  it("does not let a stopped watch schedule retries in a restarted watch", async () => {
    vi.useFakeTimers();
    let release!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValue(response(info));
    startWebSessionWatch();
    await vi.advanceTimersByTimeAsync(2000);
    stopWebSessionWatch();
    advanceAuthSessionVersion();
    startWebSessionWatch();
    release(response({}, 503));
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(browserAuthState.value).toBe("authenticated");
    await vi.advanceTimersByTimeAsync(59999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
