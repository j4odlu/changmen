import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@changmen/client-core/shared/platformHttp", () => ({
  changmenPmHttpRequest: vi.fn(),
  changmenPmEsportCall: vi.fn(),
  parseJsonLoose: (text: string) => JSON.parse(text),
}));

vi.mock("./pmTransportMode", () => ({
  resolvePmHttpMode: vi.fn(() => "vps"),
}));

import { changmenPmHttpRequest } from "@changmen/client-core/shared/platformHttp";
import { polymarketL2Get, polymarketPluginGet, polymarketPluginPost } from "./transport";

describe("polymarket transport", () => {
  beforeEach(() => {
    vi.mocked(changmenPmHttpRequest).mockReset();
  });

  test("GET 走 Pm_HttpRequest", async () => {
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({
      status: 200,
      text: JSON.stringify([{ id: "1" }]),
    });
    const rows = await polymarketPluginGet<Array<{ id: string }>>("https://gamma-api.polymarket.com/events");
    expect(rows).toEqual([{ id: "1" }]);
    expect(changmenPmHttpRequest).toHaveBeenCalledWith({
      method: "GET",
      url: "https://gamma-api.polymarket.com/events",
    });
  });

  test("GET 上游 4xx 抛错", async () => {
    vi.mocked(changmenPmHttpRequest).mockRejectedValue(new Error("rate limited"));
    await expect(polymarketPluginGet("https://gamma-api.polymarket.com/events")).rejects.toThrow("rate limited");
  });

  test("L2 GET 传 playerId + l2Path", async () => {
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ data: [] }),
    });
    const account = {
      accountId: 47,
      provider: "polymarket",
      token: "{}",
      gateway: "https://clob.polymarket.com",
    } as const;
    await polymarketL2Get(account, "https://clob.polymarket.com/data/trades?after=1", "/data/trades");
    expect(changmenPmHttpRequest).toHaveBeenCalledWith({
      method: "GET",
      url: "https://clob.polymarket.com/data/trades?after=1",
      playerId: 47,
      l2Path: "/data/trades",
    });
  });

  test("L2 POST 传 polyHeaders（未存账号）", async () => {
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ ok: true }),
    });
    await polymarketPluginPost("https://clob.polymarket.com/order", { foo: 1 }, {
      headers: {
        POLY_ADDRESS: "0xabc",
        POLY_SIGNATURE: "sig",
        POLY_TIMESTAMP: "1",
        POLY_API_KEY: "key",
        POLY_PASSPHRASE: "pass",
      },
      l2Path: "/order",
    });
    expect(changmenPmHttpRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "https://clob.polymarket.com/order",
      body: { foo: 1 },
      l2Path: "/order",
      polyHeaders: {
        POLY_ADDRESS: "0xabc",
        POLY_SIGNATURE: "sig",
        POLY_TIMESTAMP: "1",
        POLY_API_KEY: "key",
        POLY_PASSPHRASE: "pass",
      },
    });
  });

  test("L1 api-key 请求保留 POLY_NONCE", async () => {
    vi.mocked(changmenPmHttpRequest).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ apiKey: "key", secret: "secret", passphrase: "pass" }),
    });
    await polymarketPluginPost("https://clob.polymarket.com/auth/api-key", undefined, {
      headers: {
        POLY_ADDRESS: "0xabc",
        POLY_SIGNATURE: "sig",
        POLY_TIMESTAMP: "1",
        POLY_NONCE: "0",
      },
    });
    expect(changmenPmHttpRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "https://clob.polymarket.com/auth/api-key",
      polyHeaders: {
        POLY_ADDRESS: "0xabc",
        POLY_SIGNATURE: "sig",
        POLY_TIMESTAMP: "1",
        POLY_NONCE: "0",
      },
    });
  });
});
