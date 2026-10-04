import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";

const mocks = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }));
vi.mock("@changmen/client-core/shared/a8Axios", () => ({ a8Axios: { post: mocks.post }, responseBodyText: () => "" }));
vi.mock("@/lib/jwtRefresh", () => ({ refreshJwtSession: mocks.refresh }));
vi.mock("@/api/apiDelay", () => ({ armEsportPostDelaySample: vi.fn(), finalizeEsportPostDelaySample: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: { success: vi.fn() } }));
import { advanceAuthSessionVersion, beginAuthTransition, clearAuthSession, getToken, isAuthTransitionPending, isSessionInvalidResponse, post, setCookieAuthMode, setRefreshToken, setToken } from "./client";
import { login, logout } from "./auth";

function response(code: string) { return { data: { success: 0, code, msg: "未登录", info: null } }; }
const ok = { data: { success: 1, info: { saved: true } } };
beforeEach(() => {
  vi.stubEnv("VITE_WEB_COOKIE_AUTH", "0");
  vi.resetAllMocks();
  localStorage.clear();
  advanceAuthSessionVersion();
  setCookieAuthMode(false);
  setToken("old-access");
  setRefreshToken("refresh");
  vi.stubGlobal("window", { location: { href: "/sports/football" } });
  mocks.refresh.mockImplementation(async () => { setToken("new-access"); return true; });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("session recovery with unchanged business request", () => {
  it("updates cached login status when a cookie session restores its access token", async () => {
    setToken(null);
    setRefreshToken(null);
    setCookieAuthMode(true);
    const loggedIn = computed(() => Boolean(getToken()));
    expect(loggedIn.value).toBe(false);

    mocks.post.mockResolvedValueOnce(response("AUTH_REQUIRED")).mockResolvedValueOnce(ok);
    await post("Client_GetMatchs");
    expect(loggedIn.value).toBe(true);

    clearAuthSession();
    expect(loggedIn.value).toBe(false);
  });
  it.each(["ACCESS_TOKEN_EXPIRED", "AUTH_REQUIRED"])("recovers %s and replays only the rejected request once", async (code) => {
    mocks.post.mockResolvedValueOnce(response(code)).mockResolvedValueOnce(ok);
    expect(await post("Client_SaveData", { key: "ACCOUNT", content: "[]" })).toEqual(ok.data);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[0].slice(0, 2)).toEqual(mocks.post.mock.calls[1].slice(0, 2));
    expect(mocks.post.mock.calls[1][2].headers.token).toBe("new-access");
    expect(window.location.href).toBe("/sports/football");
  });
  it("preserves the session if refreshing hits a temporary outage", async () => {
    mocks.post.mockResolvedValue(response("ACCESS_TOKEN_EXPIRED"));
    mocks.refresh.mockResolvedValue(false);
    await post("Client_GetMatchs");
    expect(getToken()).toBe("old-access");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe("/sports/football");
  });
  it("does not loop or clear the session if the replay still reports AUTH_REQUIRED", async () => {
    mocks.post.mockResolvedValue(response("AUTH_REQUIRED"));
    await post("Client_GetMatchs");
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(getToken()).toBe("new-access");
  });
  it.each(["SESSION_REVOKED", "ACCOUNT_DISABLED"])("still honors explicit %s", async (code) => {
    mocks.post.mockResolvedValue(response(code));
    await post("Client_GetMatchs");
    expect(getToken()).toBeNull();
    expect(window.location.href).toBe("/");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("ignores an obsolete failure after a new login", async () => {
    let finish!: (value: unknown) => void;
    mocks.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = post("Client_GetMatchs");
    setToken("new-login"); advanceAuthSessionVersion();
    finish(response("SESSION_REVOKED"));
    await expect(pending).rejects.toThrow("登录状态已变更");
    expect(getToken()).toBe("new-login");
    expect(window.location.href).toBe("/sports/football");
  });
  it("never replays a network failure or a business rejection", async () => {
    mocks.post.mockRejectedValueOnce(new Error("502"));
    await expect(post("Client_SaveData")).rejects.toThrow("502");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    mocks.post.mockResolvedValueOnce(response("BUSINESS_ERROR"));
    await post("Client_SaveData");
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(getToken()).toBe("old-access");
  });
  it("leaves refresh responses to the version-guarded refresh handler", async () => {
    mocks.post.mockResolvedValue(response("REFRESH_TOKEN_EXPIRED"));
    await post("Client_RefreshToken");
    expect(getToken()).toBe("old-access");
  });
  it("does not replay a protected request after logout during refresh", async () => {
    mocks.post.mockResolvedValue(response("ACCESS_TOKEN_EXPIRED"));
    mocks.refresh.mockImplementation(async () => { clearAuthSession(); return false; });
    await expect(post("Client_SaveData")).rejects.toThrow("登录状态已变更");
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it("uses codes ahead of ambiguous message strings", () => {
    expect(isSessionInvalidResponse("TEMPORARY_UNAVAILABLE", "未登录")).toBe(false);
    expect(isSessionInvalidResponse(undefined, "未登录")).toBe(true);
  });
  it("ignores successful old-user responses after switching sessions", async () => {
    let finish!: (value: unknown) => void;
    mocks.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = post("Client_GetData");
    advanceAuthSessionVersion();
    finish(ok);
    await expect(pending).rejects.toThrow("登录状态已变更");
  });
  it("uses an already renewed token when a late expired response arrives", async () => {
    let finish!: (value: unknown) => void;
    mocks.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(ok);
    const pending = post("Client_GetMatchs");
    setToken("renewed-by-another-request");
    finish(response("ACCESS_TOKEN_EXPIRED"));
    await expect(pending).resolves.toEqual(ok.data);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
  it("ends an expired access-only session that has no renewal credential", async () => {
    setRefreshToken(null);
    mocks.post.mockResolvedValue(response("ACCESS_TOKEN_EXPIRED"));
    mocks.refresh.mockResolvedValue(false);
    await post("Client_GetMatchs");
    expect(getToken()).toBeNull();
  });
  it("blocks a stale tab before its queued storage event arrives", async () => {
    localStorage.setItem("app:session-version", "login-in-other-tab");
    await expect(post("Client_SaveData")).rejects.toThrow("登录状态已变更");
    expect(mocks.post).not.toHaveBeenCalled();
    expect(localStorage.getItem("app:session-version")).toBe("login-in-other-tab");
    expect(window.location.href).toBe("/sports/football");
  });
  it("an old tab cannot log out the new session while waiting for its storage event", async () => {
    localStorage.setItem("app:session-version", "login-in-other-tab");
    await logout();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(localStorage.getItem("app:session-version")).toBe("login-in-other-tab");
  });
  it("does not let an old revoked response abort a login whose response is still pending", async () => {
    let finishRead!: (value: unknown) => void;
    let finishLogin!: (value: unknown) => void;
    mocks.post.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishLogin = resolve; }));
    const read = post("Client_GetMatchs");
    const entering = login("GB14", "test-password");
    finishRead(response("SESSION_REVOKED"));
    const check = expect(read).rejects.toThrow("登录状态正在更新");
    finishLogin({ data: { success: 1, info: { token: "new-login", sessionMode: "cookie" } } });
    await check;
    await entering;
    expect(getToken()).toBe("new-login");
    expect(window.location.href).toBe("/sports/football");
  });
  it("removes the transition guard after a failed login without losing the previous session", async () => {
    mocks.post.mockRejectedValue(new Error("502"));
    await expect(login("GB14", "test-password")).rejects.toThrow("502");
    expect(isAuthTransitionPending()).toBe(false);
    expect(getToken()).toBe("old-access");
  });
  it("expires an abandoned transition and prevents an older cleanup from removing a newer one", () => {
    vi.useFakeTimers();
    const finishFirst = beginAuthTransition();
    vi.advanceTimersByTime(1);
    beginAuthTransition();
    finishFirst();
    expect(isAuthTransitionPending()).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(isAuthTransitionPending()).toBe(false);
  });
  it("serializes logout and the next login so a late cookie clear cannot erase the new login", async () => {
    let tail = Promise.resolve();
    vi.stubGlobal("navigator", { locks: { request: (_name: string, run: () => Promise<unknown>) => {
      const task = tail.then(run); tail = task.then(() => undefined); return task;
    } } });
    let finish!: (value: unknown) => void;
    mocks.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ data: { success: 1, info: { token: "new-login", sessionMode: "cookie" } } });
    const exiting = logout();
    const entering = login("GB14", "test-password");
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(getToken()).toBeNull();
    finish(ok);
    await exiting; await entering;
    expect(getToken()).toBe("new-login");
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});
