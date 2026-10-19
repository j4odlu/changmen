import { describe, expect, it, vi, beforeEach } from "vitest";
import { accountGet, normalizeRayAuthorization } from "./accountHttp";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";

const accountHttpRequest = vi.fn();
vi.mock("@changmen/client-core/shared/platformHttp", () => ({
  accountHttpRequest: (...args: unknown[]) => accountHttpRequest(...args),
}));

describe("normalizeRayAuthorization", () => {
  it("preserves Bearer token from chrome plugin", () => {
    expect(normalizeRayAuthorization("Bearer abc")).toBe("Bearer abc");
  });

  it("adds Bearer prefix for raw RAY token", () => {
    expect(normalizeRayAuthorization("abc")).toBe("Bearer abc");
  });
});

describe("accountGet", () => {
  beforeEach(() => {
    accountHttpRequest.mockReset();
    accountHttpRequest.mockResolvedValue({ text: "{\"code\":200}" });
  });

  it("sends normalized authorization header", async () => {
    const account = new PlatformAccount({
      accountId: 1,
      playerName: "ray",
      provider: "RAY",
      gateway: "https://ray.example",
      token: "raw-token",
    });

    await accountGet(account, "/v2/user", { forceDirect: true });

    expect(accountHttpRequest).toHaveBeenCalledWith(
      account,
      "https://ray.example/v2/user",
      {
        method: "GET",
        headers: {
          authorization: "Bearer raw-token",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
      },
      true,
    );
  });
});
