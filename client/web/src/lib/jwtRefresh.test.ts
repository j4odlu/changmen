import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshJwtSession } from "@/lib/jwtRefresh";

const mocks = vi.hoisted(() => ({
  clearAuthSession: vi.fn(),
  getRefreshToken: vi.fn<() => string | null>(),
  post: vi.fn(),
  setRefreshToken: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  clearAuthSession: mocks.clearAuthSession,
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
  beforeEach(() => {
    vi.useRealTimers();
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
});
