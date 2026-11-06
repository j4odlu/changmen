import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@changmen/client-core/shared/a8Axios", () => ({ a8Axios: { post: request }, responseBodyText: () => "" }));
vi.mock("@/api/apiDelay", () => ({ armEsportPostDelaySample: vi.fn(), finalizeEsportPostDelaySample: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: { success: vi.fn() } }));
import { advanceAuthSessionVersion, browserAuthState, clearAuthSession, getAuthSessionVersion, getCookieSessionInfo, post, setCookieAuthMode, setCookieSessionInfo } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("window", { location: { pathname: "/listener", href: "/listener#/sports/football" }, dispatchEvent: vi.fn() });
  advanceAuthSessionVersion();
  setCookieAuthMode(true);
  setCookieSessionInfo({ user: { id: "mock-owner", userName: "mock-user", role: "user" }, browserSessionId: "mock-browser", loginEpoch: "mock-epoch", cookieEnabled: true, csrfToken: "mock-csrf" });
});
afterEach(() => { clearAuthSession(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("real shared API and original authentication with listener return URL", () => {
  it.each(["SESSION_REVOKED", "ACCOUNT_DISABLED"])("clears %s credentials and keeps re-login in listener mode without replaying a request", async code => {
    const version = getAuthSessionVersion();
    request.mockResolvedValueOnce({ data: { success: 0, code, msg: "未登录", info: null } });
    await post("Client_GetMatchs");
    expect(request).toHaveBeenCalledOnce();
    expect(getCookieSessionInfo()).toBeNull();
    expect(browserAuthState.value).toBe("anonymous");
    expect(getAuthSessionVersion()).not.toBe(version);
    expect(window.location.href).toBe("/listener#/");
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "changmen:auth-ending" }));
  });
});
