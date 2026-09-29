import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshJwtSession, startJwtAutoRefresh, stopJwtAutoRefresh } from "@/lib/jwtRefresh";

const mocks = vi.hoisted(() => ({
  clearAuthSession: vi.fn(),
  version: "session-1",
  cookieMode: false,
  transitionPending: false,
  getRefreshToken: vi.fn<() => string | null>(),
  post: vi.fn(),
  setRefreshToken: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  invalidateAuthSession: mocks.clearAuthSession,
  getAuthSessionVersion: () => mocks.version,
  isAuthSessionCurrent: (version: string) => version === mocks.version,
  isAuthTransitionPending: () => mocks.transitionPending,
  isCookieAuthMode: () => mocks.cookieMode,
  setCookieAuthMode: vi.fn(),
  getRefreshToken: mocks.getRefreshToken,
  isSessionInvalidResponse: (code: unknown, message: unknown) => [
    "AUTH_REQUIRED",
    "REFRESH_TOKEN_EXPIRED",
    "SESSION_REVOKED",
  ].includes(String(code || "")) || [
    "请先登录",
    "未登录",
    "账号已在其他设备登录",
    "会话已失效，请重新登录",
  ].includes(String(message || "")),
  post: mocks.post,
  setRefreshToken: mocks.setRefreshToken,
  setToken: mocks.setToken,
}));

describe("refreshJwtSession", () => {
  afterEach(() => {
    stopJwtAutoRefresh();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  beforeEach(() => {
    vi.useRealTimers();
    mocks.version = "session-1";
    mocks.cookieMode = false;
    mocks.transitionPending = false;
    mocks.clearAuthSession.mockReset();
    mocks.getRefreshToken.mockReset();
    mocks.getRefreshToken.mockReturnValue("refresh-old");
    mocks.post.mockReset();
    mocks.setRefreshToken.mockReset();
    mocks.setToken.mockReset();
  });

  it("保留会话 when a temporary request error exhausts retries", async () => {
    mocks.post.mockRejectedValue(new Error("502 Bad Gateway"));

    await expect(refreshJwtSession([])).resolves.toBe(false);

    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(mocks.getRefreshToken()).toBe("refresh-old");
  });

  it("keeps the session when the server reports a temporary auth outage", async () => {
    mocks.post.mockResolvedValue({
      success: 0,
      code: "TEMPORARY_UNAVAILABLE",
      msg: "登录服务暂时不可用，请稍后重试",
      info: null,
    });

    await expect(refreshJwtSession([])).resolves.toBe(false);

    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
  });

  it("retries a temporary failure and stores the refreshed tokens", async () => {
    vi.useFakeTimers();
    mocks.post
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({
        success: 1,
        msg: "ok",
        info: { token: "access-new", refreshToken: "refresh-new" },
      });

    const result = refreshJwtSession([10]);
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBe(true);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.setToken).toHaveBeenCalledWith("access-new");
    expect(mocks.setRefreshToken).toHaveBeenCalledWith("refresh-new");
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
  });

  it("clears the session only when the server explicitly revokes it", async () => {
    mocks.post.mockResolvedValue({
      success: 0,
      code: "SESSION_REVOKED",
      msg: "localized message may change",
      info: null,
    });

    await expect(refreshJwtSession([])).resolves.toBe(false);

    expect(mocks.clearAuthSession).toHaveBeenCalledTimes(1);
  });

  it("does not abort a pending login when old cookie refresh is revoked", async () => {
    mocks.transitionPending = true;
    mocks.post.mockResolvedValue({ success: 0, code: "SESSION_REVOKED" });
    await expect(refreshJwtSession([])).resolves.toBe(false);
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
  });

  it("shares one in-flight refresh across concurrent callers", async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    mocks.post.mockImplementation(() => new Promise((resolve) => {
      resolvePost = resolve;
    }));

    const first = refreshJwtSession([]);
    const second = refreshJwtSession([]);

    expect(second).toBe(first);
    expect(mocks.post).toHaveBeenCalledTimes(1);

    resolvePost?.({
      success: 1,
      msg: "ok",
      info: { token: "access-new", refreshToken: "refresh-new" },
    });
    await expect(first).resolves.toBe(true);
  });

  it.each([true, false])("ignores a slow refresh after login/logout (success=%s)", async (success) => {
    let finish!: (value: unknown) => void;
    mocks.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = refreshJwtSession([]);
    mocks.version = "session-2";
    finish(success
      ? { success: 1, info: { token: "obsolete", refreshToken: "obsolete" } }
      : { success: 0, code: "SESSION_REVOKED" });
    await expect(pending).resolves.toBe(false);
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
  });

  it("uses the HttpOnly session without a JS refresh token", async () => {
    const requestLock = vi.fn();
    vi.stubGlobal("navigator", { locks: { request: requestLock } });
    mocks.cookieMode = true;
    mocks.getRefreshToken.mockReturnValue(null);
    mocks.post.mockResolvedValue({ success: 1, info: { token: "access-new", sessionMode: "cookie" } });
    await expect(refreshJwtSession([])).resolves.toBe(true);
    expect(mocks.post).toHaveBeenCalledWith("Client_RefreshToken", {});
    expect(mocks.setRefreshToken).toHaveBeenCalledWith(null);
    expect(requestLock).not.toHaveBeenCalled();
  });

  it("reads another tab's latest refresh token after acquiring the shared lock", async () => {
    let run!: () => Promise<boolean>;
    vi.stubGlobal("navigator", { locks: { request: vi.fn((_name, callback) => new Promise(resolve => {
      run = async () => { const value = await callback(); resolve(value); return value; };
    })) } });
    try {
      const pending = refreshJwtSession([]);
      expect(mocks.post).not.toHaveBeenCalled();
      mocks.getRefreshToken.mockReturnValue("other-tab-latest");
      mocks.post.mockResolvedValue({ success: 1, info: { token: "new", refreshToken: "next" } });
      await run();
      await expect(pending).resolves.toBe(true);
      expect(mocks.post).toHaveBeenCalledWith("Client_RefreshToken", { refreshToken: "other-tab-latest" });
    }
    finally { vi.unstubAllGlobals(); }
  });

  it("renews on wake/online, debounces duplicate events and removes listeners on stop", async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", target);
    vi.stubGlobal("document", doc);
    mocks.post.mockResolvedValue({ success: 1, info: { token: "new", refreshToken: "next" } });
    startJwtAutoRefresh();
    target.dispatchEvent(new Event("online"));
    target.dispatchEvent(new Event("focus"));
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    target.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.post).toHaveBeenCalledTimes(2);
    stopJwtAutoRefresh();
    await vi.advanceTimersByTimeAsync(600_000);
    target.dispatchEvent(new Event("online"));
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it("two tab instances serialize rotation and use the token stored by the preceding tab", async () => {
    let tail = Promise.resolve();
    vi.stubGlobal("navigator", { locks: { request: (_name: string, callback: () => Promise<boolean>) => {
      const next = tail.then(callback);
      tail = next.then(() => undefined);
      return next;
    } } });
    vi.resetModules();
    const tabA = await import("@/lib/jwtRefresh");
    vi.resetModules();
    const tabB = await import("@/lib/jwtRefresh");
    mocks.setRefreshToken.mockImplementation(value => mocks.getRefreshToken.mockReturnValue(value));
    mocks.post.mockResolvedValueOnce({ success: 1, info: { token: "a1", refreshToken: "r1" } })
      .mockResolvedValueOnce({ success: 1, info: { token: "a2", refreshToken: "r2" } });
    await expect(Promise.all([tabA.refreshJwtSession([]), tabB.refreshJwtSession([])])).resolves.toEqual([true, true]);
    expect(mocks.post.mock.calls.map(call => call[1].refreshToken)).toEqual(["refresh-old", "r1"]);
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
  });
});
