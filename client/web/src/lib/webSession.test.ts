import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceAuthSessionVersion, beginAuthTransition, browserAuthState, clearAuthSession, getCookieSessionInfo, hasAuthSession, setCookieAuthMode, setCookieSessionInfo } from "@/api/client";
import { probeCookieSession } from "./webSession";
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
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { origin: "https://changmen.fun", href: "/" } });
});
afterEach(() => { vi.unstubAllGlobals(); });
describe("browser session recovery", () => {
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
});
