import { beforeEach, describe, expect, test, vi } from "vitest";
import { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { iaGatewayPath, iaMrPost } from "./bet_transport";

const accountIaPost = vi.fn();
const a8PluginPost = vi.fn();

vi.mock("./accountHttp", () => ({
  accountIaPost: (...args: unknown[]) => accountIaPost(...args),
}));

vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({
  hasA8PluginRuntime: () => true,
  a8PluginPost: (...args: unknown[]) => a8PluginPost(...args),
}));

describe("iaMrPost (A8 mr.post + Cr.http)", () => {
  const account = new PlatformAccount({
    accountId: 1,
    playerName: "ia",
    provider: "IA",
    gateway: "https://ia.example",
    token: "tok",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    a8PluginPost.mockResolvedValue({ data: { code: 1 } });
    accountIaPost.mockResolvedValue({ code: 1 });
  });

  test("无 proxyId 时走 Zn.post（a8PluginPost）", async () => {
    await iaMrPost(account, "/api/game/user/playMore/", "lang=1");
    expect(a8PluginPost).toHaveBeenCalledWith(
      "https://ia.example/api/game/user/playMore/",
      "lang=1",
      { headers: expect.objectContaining({ token: "tok" }) },
    );
    expect(accountIaPost).not.toHaveBeenCalled();
  });

  test("forceDirect 时即使有 proxyId 也走 Zn", async () => {
    const proxied = { ...account, proxyId: 9 } as PlatformAccount;
    await iaMrPost(proxied, "/api/game/user/getUserHistory/", "body=1", {
      forceDirect: true,
    });
    expect(a8PluginPost).toHaveBeenCalledOnce();
    expect(accountIaPost).not.toHaveBeenCalled();
  });

  test("有 proxyId 且非 forceDirect 时走 PROXY relay", async () => {
    const proxied = { ...account, proxyId: 9 } as PlatformAccount;
    await iaMrPost(proxied, "/api/game/user/playMore/", "items=%5B%5D");
    expect(accountIaPost).toHaveBeenCalledWith(
      proxied,
      "/api/game/user/playMore/",
      "items=%5B%5D",
    );
    expect(a8PluginPost).not.toHaveBeenCalled();
  });

  test("iaGatewayPath 对齐 cy(t,e)", () => {
    expect(iaGatewayPath(account, "/api/game/user/balance")).toBe(
      "https://ia.example/api/game/user/balance",
    );
  });
});
