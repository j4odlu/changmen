import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUserStore } from "@/stores/userStore";
import { SessionRestoreConfigurationError } from "@/lib/sessionRestoreError";

const auth = vi.hoisted(() => ({
  clearAuthSession: vi.fn(),
  ensureTokenRefresh: vi.fn(),
  cookieMode: false,
  refreshToken: "refresh-token" as string | null,
  token: "access-token" as string | null,
}));

vi.mock("@/api/client", () => ({
  browserAuthState: { value: "checking" },
  clearAuthSession: auth.clearAuthSession,
  getRefreshToken: () => auth.refreshToken,
  hasAuthSession: () => Boolean(auth.token || auth.refreshToken || auth.cookieMode),
  isCookieAuthMode: () => auth.cookieMode,
  isWebAuthenticated: () => Boolean(auth.token),
}));

vi.mock("@/api/esport", () => ({
  getClientData: vi.fn(),
  getClientDataArray: vi.fn(),
  getToken: () => auth.token,
  getUserInfo: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  saveClientData: vi.fn(),
  saveClientDataDetailed: vi.fn(),
  updateUserSetting: vi.fn(),
}));

vi.mock("@/lib/sessionRefresh", () => ({
  ensureTokenRefresh: auth.ensureTokenRefresh,
  startTokenRefresh: vi.fn(),
  stopTokenRefresh: vi.fn(),
}));

describe("userStore.restoreSession", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    auth.token = "access-token";
    auth.refreshToken = "refresh-token";
    auth.cookieMode = false;
    auth.clearAuthSession.mockReset();
    auth.clearAuthSession.mockImplementation(() => {
      auth.token = null;
      auth.refreshToken = null;
    });
    auth.ensureTokenRefresh.mockReset();
    auth.ensureTokenRefresh.mockResolvedValue(undefined);
  });

  it("keeps local credentials and offers retry after a temporary user-info failure", async () => {
    const store = useUserStore();
    store.fetchUserInfo = vi.fn().mockRejectedValue(new Error("502 Bad Gateway"));

    await expect(store.restoreSession()).resolves.toBe(false);

    expect(auth.token).toBe("access-token");
    expect(auth.refreshToken).toBe("refresh-token");
    expect(auth.clearAuthSession).not.toHaveBeenCalled();
    expect(store.sessionChecked).toBe(false);
    expect(store.sessionRestoreError).toBe("连接暂时不可用，请检查网络后重试");
  });

  it("finishes session checking after an explicit invalidation cleared the token", async () => {
    const store = useUserStore();
    store.fetchUserInfo = vi.fn().mockImplementation(async () => {
      auth.token = null;
      auth.refreshToken = null;
      throw new Error("未登录");
    });

    await expect(store.restoreSession()).resolves.toBe(false);

    expect(store.sessionChecked).toBe(true);
    expect(store.sessionRestoreError).toBe("");
  });

  it("shows recovery error when a cookie session cannot obtain an access token", async () => {
    auth.token = null;
    auth.refreshToken = null;
    auth.cookieMode = true;
    const store = useUserStore();
    await expect(store.restoreSession()).resolves.toBe(false);
    expect(store.ready).toBe(false);
    expect(store.sessionChecked).toBe(false);
    expect(store.sessionRestoreError).toBeTruthy();
    expect(auth.clearAuthSession).not.toHaveBeenCalled();
  });

  it("handles an initialization exception without abandoning the local session", async () => {
    auth.ensureTokenRefresh.mockRejectedValue(new Error("chunk unavailable"));
    const store = useUserStore();
    await expect(store.restoreSession()).resolves.toBe(false);
    expect(store.sessionRestoreError).toBeTruthy();
    expect(auth.clearAuthSession).not.toHaveBeenCalled();
  });

  it("preserves credentials and the specific error when restoration requires a configuration fix", async () => {
    auth.ensureTokenRefresh.mockRejectedValue(new SessionRestoreConfigurationError("认证来源配置不匹配"));
    const store = useUserStore();
    await expect(store.restoreSession()).resolves.toBe(false);
    expect(store.sessionRestoreError).toBe("认证来源配置不匹配");
    expect(store.sessionRestoreRetryable).toBe(false);
    expect(auth.clearAuthSession).not.toHaveBeenCalled();
  });
});
