import { describe, expect, it, vi, beforeEach } from "vitest";
import { accountGet } from "./accountHttp";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";

const accountHttpRequest = vi.fn();
vi.mock("@changmen/client-core/shared/platformHttp", () => ({
  accountHttpRequest: (...args: unknown[]) => accountHttpRequest(...args),
}));

describe("accountGet", () => {
  beforeEach(() => {
    accountHttpRequest.mockReset();
    accountHttpRequest.mockResolvedValue({ text: "{\"code\":200}" });
  });

  it.each(["raw-token", "Bearer abc", " Bearer abc "])("原样发送 A8 authorization: %s", async (token) => {
    const account = new PlatformAccount({
      accountId: 1,
      playerName: "ray",
      provider: "RAY",
      gateway: "https://ray.example",
      token,
    });

    await accountGet(account, "/v2/user", { forceDirect: true });

    expect(accountHttpRequest).toHaveBeenCalledWith(
      account,
      "https://ray.example/v2/user",
      {
        method: "GET",
        headers: {
          authorization: token,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
      },
      true,
      { preserveAcceptedResponse: true },
    );
  });
});
