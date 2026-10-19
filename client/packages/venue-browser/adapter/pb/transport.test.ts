import { describe, expect, test, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { pbCollectEuroOdds, pbGatewayUrl, pbGet } from "./transport";

const a8PluginGet = vi.fn();
vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({
  a8PluginGet: (...args: unknown[]) => a8PluginGet(...args),
  a8PluginPost: vi.fn(),
}));

vi.mock("./auth", () => ({
  buildPbAuthHeaders: () => ({ "x-custid-515": "1" }),
  pbAccountUsesLiveTab: () => false,
  resolvePbAccountVenueMemberId: () => "",
}));

vi.mock("./tabId", () => ({
  readPbTabIdFromPlugin: async () => undefined,
  setPbTabIdCached: () => {},
  isPbTabMiss: () => false,
  isPbLiveTabDead: () => false,
  pbLiveTabHardError: () => undefined,
}));

vi.mock("./liveCredential", () => ({
  applyPbLiveCredentialFromPlugin: async () => false,
}));

const account: PlatformAccount = {
  provider: "PB",
  gateway: "https://pb.example",
  token: "t",
} as PlatformAccount;

describe("pbGatewayUrl (A8 Ly)", () => {
  test("gateway 与 path 直接拼接", () => {
    expect(pbGatewayUrl({ gateway: "https://pb.example" }, "/member-service/v2/account-balance")).toBe(
      "https://pb.example/member-service/v2/account-balance",
    );
  });

});

describe("pbCollectEuroOdds (A8 gHe)", () => {
  test("Zn.get 完整 URL，不经 pbGatewayUrl", async () => {
    a8PluginGet.mockResolvedValue({ data: { leagues: [] } });
    const data = await pbCollectEuroOdds(account, true);
    expect(a8PluginGet).toHaveBeenCalledTimes(1);
    const [url, opts] = a8PluginGet.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toMatch(/^https:\/\/pb\.example\/sports-service\/sv\/euro\/odds\?/);
    expect(url).not.toContain("pb.examplehttps");
    expect(opts.headers["x-custid-515"]).toBe("1");
    expect(data).toEqual({ leagues: [] });
  });
});

describe("pbGet (A8 Zn.get)", () => {
  test("unwrap axios response.data", async () => {
    a8PluginGet.mockResolvedValue({ data: { success: true, betCredit: 100 } });
    const data = await pbGet<{ success: boolean; betCredit: number }>(
      account,
      "/member-service/v2/account-balance",
    );
    expect(a8PluginGet).toHaveBeenCalledWith(
      "https://pb.example/member-service/v2/account-balance",
      { headers: { "x-custid-515": "1" } },
    );
    expect(data).toEqual({ success: true, betCredit: 100 });
  });

  test("Zn 返回 null 时得到 undefined", async () => {
    a8PluginGet.mockResolvedValue(undefined);
    const data = await pbGet(account, "/member-service/v2/account-balance");
    expect(data).toBeUndefined();
  });
});
