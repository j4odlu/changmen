import { beforeEach, describe, expect, test, vi } from "vitest";
import { resolveCollectSession } from "./collectSession";

const getCollectPlatform = vi.hoisted(() => vi.fn());
const accountState = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@changmen/client-core/bridge/clientApi", () => ({
  getCollectPlatform,
}));

vi.mock("@changmen/venue-browser/shared/webBridge", () => ({
  useAccountStore: () => accountState,
}));

describe("resolveCollectSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountState.accounts = [];
  });

  test("skips platform config fallback when disabled", async () => {
    const session = await resolveCollectSession("IMT", { allowPlatformFallback: false });

    expect(session).toBeNull();
    expect(getCollectPlatform).not.toHaveBeenCalled();
  });

  test("uses account session before platform config", async () => {
    accountState.accounts = [
      {
        provider: "IMT",
        gateway: "https://imt.example",
        token: "token-1",
        balance: 1,
        referer: "https://ref.example",
      },
    ];

    await expect(resolveCollectSession("IMT", { allowPlatformFallback: false })).resolves.toEqual({
      gateway: "https://imt.example",
      token: "token-1",
      referer: "https://ref.example",
      userAgent: undefined,
    });
    expect(getCollectPlatform).not.toHaveBeenCalled();
  });
});
