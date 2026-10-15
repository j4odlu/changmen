import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUserStore } from "@/stores/userStore";
import { SessionRestoreConfigurationError } from "@/lib/sessionRestoreError";
import { capturePmFokPreflightMode, setPmFokPreflightMode } from "@changmen/venue-adapter/polymarket";
import { getClientData, getClientDataArray, saveClientDataDetailed } from "@/api/esport";

const auth = vi.hoisted(() => ({
  clearAuthSession: vi.fn(),
  logout: vi.fn(),
  ensureTokenRefresh: vi.fn(),
  cookieMode: false,
  refreshToken: "refresh-token" as string | null,
  token: "access-token" as string | null,
  probe: vi.fn(),
}));
vi.mock("@/lib/webSession", () => ({ probeCookieSession: auth.probe }));

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
  logout: auth.logout,
  saveClientData: vi.fn(),
  saveClientDataDetailed: vi.fn(),
  updateUserSetting: vi.fn(),
}));

vi.mock("@/lib/sessionRefresh", () => ({
  ensureTokenRefresh: auth.ensureTokenRefresh,
  startTokenRefresh: vi.fn(),
  stopTokenRefresh: vi.fn(),
}));

describe("FOK preflight preference persistence", () => {
  const modeForNewAttempt = () => capturePmFokPreflightMode({} as any);
  beforeEach(() => {
    setActivePinia(createPinia()); setPmFokPreflightMode("legacy");
    const user = useUserStore(); user.userId = 12;
    vi.spyOn(user, "syncPbCollectModeFromLocal").mockResolvedValue();
    vi.spyOn(user, "syncPmArbPriceBufferFromPrefs").mockResolvedValue();
    vi.spyOn(user, "syncPmFokDepthBufferFromPrefs").mockResolvedValue();
    vi.spyOn(user, "syncPfArbPriceBufferFromPrefs").mockResolvedValue();
    vi.mocked(saveClientDataDetailed).mockReset();
    vi.mocked(getClientDataArray).mockResolvedValue([]);
  });
  it("loads the saved mode and resets old accounts without the field to legacy", async () => {
    vi.mocked(getClientData).mockResolvedValue({ pmFokPreflightMode: "optimized" });
    await useUserStore().loadExtras(true);
    expect(modeForNewAttempt()).toBe("optimized");
    vi.mocked(getClientData).mockResolvedValue({});
    await useUserStore().loadExtras(true);
    expect(modeForNewAttempt()).toBe("legacy");
  });
  it("does not activate an unsaved edit or a failed save", async () => {
    useUserStore().extensionPrefs.pmFokPreflightMode = "optimized";
    expect(modeForNewAttempt()).toBe("legacy");
    vi.mocked(saveClientDataDetailed).mockResolvedValue({ ok: false, msg: "offline" });
    await expect(useUserStore().saveExtensionPrefs()).rejects.toThrow("offline");
    expect(modeForNewAttempt()).toBe("legacy");
  });
  it("applies exactly the persisted selection after success, leaving pending edits for the next save", async () => {
    const user = useUserStore(); user.extensionPrefs.pmFokPreflightMode = "optimized";
    let finish!: (value: any) => void;
    vi.mocked(saveClientDataDetailed).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const saving = user.saveExtensionPrefs();
    await vi.waitFor(() => expect(saveClientDataDetailed).toHaveBeenCalledOnce());
    user.extensionPrefs.pmFokPreflightMode = "legacy";
    expect(modeForNewAttempt()).toBe("legacy");
    expect(JSON.parse(vi.mocked(saveClientDataDetailed).mock.calls[0]![1]).pmFokPreflightMode).toBe("optimized");
    finish({ ok: true }); await saving;
    expect(modeForNewAttempt()).toBe("optimized");
  });
  it("does not apply a prior user's pending save to a different login", async () => {
    const user = useUserStore(); user.extensionPrefs.pmFokPreflightMode = "optimized";
    let finish!: (value: any) => void;
    vi.mocked(saveClientDataDetailed).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const saving = user.saveExtensionPrefs();
    await vi.waitFor(() => expect(saveClientDataDetailed).toHaveBeenCalledOnce());
    user.userId = 13;
    finish({ ok: true }); await saving;
    expect(modeForNewAttempt()).toBe("legacy");
  });
});

describe("userStore.restoreSession", () => {
  afterEach(() => vi.unstubAllGlobals());
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
    auth.logout.mockReset();
    auth.probe.mockReset();
  });
  it("preserves a configuration error on the first probe without a local session hint", async () => {
    auth.token = null; auth.refreshToken = null; auth.cookieMode = false;
    vi.stubGlobal("window", {}); vi.stubGlobal("document", {});
    auth.probe.mockRejectedValue(new SessionRestoreConfigurationError("服务端未启用 Cookie 登录"));
    const store = useUserStore();
    expect(await store.restoreSession()).toBe(false);
    expect(store.sessionRestoreRetryable).toBe(false);
    expect(store.sessionRestoreError).toBe("服务端未启用 Cookie 登录");
    expect(auth.clearAuthSession).not.toHaveBeenCalled();
  });

  it("preserves new user state when an old logout is superseded", async () => {
    const store = useUserStore();
    store.userName = "new-user";
    store.ready = true;
    auth.logout.mockResolvedValue(false);
    expect(await store.logout()).toBe(false);
    expect(store.userName).toBe("new-user");
    expect(store.ready).toBe(true);
  });

  it("keeps the logout entry available when server confirmation fails", async () => {
    const store = useUserStore();
    store.userName = "river";
    store.ready = true;
    auth.logout.mockRejectedValue(new Error("退出尚未确认"));
    await expect(store.logout()).rejects.toThrow("退出尚未确认");
    expect(store.userName).toBe("river");
    expect(store.ready).toBe(true);
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
