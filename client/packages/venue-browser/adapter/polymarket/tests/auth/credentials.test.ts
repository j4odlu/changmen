import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createL1Headers } from "@polymarket/clob-client-v2";
import { createWalletClient, http, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const { polymarketPluginGet, polymarketPluginPost } = vi.hoisted(() => ({
  polymarketPluginGet: vi.fn(),
  polymarketPluginPost: vi.fn(),
}));
vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({ polymarketPluginGet, polymarketPluginPost }));

import { createOrDerivePolymarketApiCreds } from "@changmen/venue-browser/polymarket/auth/credentials";

// Public synthetic keys only. Real SDK signing; all HTTP is offline.
const privateKey = `0x${"1".repeat(64)}` as Hex;
const signerAddress = privateKeyToAccount(privateKey).address;
const gateway = "https://clob.polymarket.com";
const apiCreds = { apiKey: "synthetic-key", secret: "synthetic-secret", passphrase: "synthetic-pass" };
const input = { privateKey, walletAddress: signerAddress };
const unexpectedFetch = vi.fn();

async function legacyHeaders(key: Hex, timestamp: number) {
  const signer = createWalletClient({ account: privateKeyToAccount(key), chain: polygon, transport: http() });
  return createL1Headers(signer, 137, undefined, timestamp);
}

describe("Polymarket browser L1 credentials", () => {
  beforeEach(() => {
    polymarketPluginGet.mockReset();
    polymarketPluginPost.mockReset();
    unexpectedFetch.mockReset().mockImplementation(() => { throw new Error("unexpected network request"); });
    vi.stubGlobal("fetch", unexpectedFetch);
  });
  afterEach(() => {
    expect(unexpectedFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test.each(["1", "2", "3"].flatMap(digit => [100, 1792800000.9].map(time => ({ digit, time }))))(
    "matches legacy L1 headers and recovers signer for key $digit / time $time", async ({ digit, time }) => {
      const key = `0x${digit.repeat(64)}` as Hex;
      const address = privateKeyToAccount(key).address;
      const timestamp = Math.floor(time);
      polymarketPluginGet.mockResolvedValueOnce(String(time));
      polymarketPluginPost.mockResolvedValueOnce(apiCreds);

      expect(await createOrDerivePolymarketApiCreds({ privateKey: key, walletAddress: address })).toEqual({ signerAddress: address, apiCreds });
      const headers = polymarketPluginPost.mock.calls[0][2].headers;
      expect(headers).toEqual(await legacyHeaders(key, timestamp));
      expect(polymarketPluginGet.mock.calls).toEqual([[`${gateway}/time`]]);
      expect(polymarketPluginPost.mock.calls).toEqual([[`${gateway}/auth/api-key`, undefined, { headers }]]);
      expect(await recoverTypedDataAddress({
        domain: { name: "ClobAuthDomain", version: "1", chainId: 137 },
        types: { ClobAuth: [
          { name: "address", type: "address" }, { name: "timestamp", type: "string" },
          { name: "nonce", type: "uint256" }, { name: "message", type: "string" },
        ] },
        primaryType: "ClobAuth",
        message: { address, timestamp: String(timestamp), nonce: 0n, message: "This message attests that I control the given wallet" },
        signature: headers.POLY_SIGNATURE as Hex,
      })).toBe(address);
    },
  );

  test("re-fetches time and re-signs derive after create failure, preserving request order", async () => {
    const requests: string[] = [];
    polymarketPluginGet.mockImplementation(async (url: string) => {
      requests.push(url);
      return url.endsWith("/time") ? (requests.length === 1 ? "100" : "101") : apiCreds;
    });
    polymarketPluginPost.mockImplementation(async (url: string) => {
      requests.push(url);
      throw new Error("Could not create api key");
    });
    expect(await createOrDerivePolymarketApiCreds(input)).toEqual({ signerAddress, apiCreds });
    expect(requests).toEqual([`${gateway}/time`, `${gateway}/auth/api-key`, `${gateway}/time`, `${gateway}/auth/derive-api-key`]);
    expect(polymarketPluginPost.mock.calls).toEqual([[`${gateway}/auth/api-key`, undefined, { headers: await legacyHeaders(privateKey, 100) }]]);
    expect(polymarketPluginGet.mock.calls[2]).toEqual([`${gateway}/auth/derive-api-key`, { headers: await legacyHeaders(privateKey, 101) }]);
  });

  test.each([undefined, "invalid", {}, { apiKey: "key", secret: "secret" }])("derives after incomplete create response: %j", async created => {
    polymarketPluginGet.mockResolvedValueOnce(100).mockResolvedValueOnce(101)
      .mockResolvedValueOnce({ key: apiCreds.apiKey, secret: apiCreds.secret, passphrase: apiCreds.passphrase });
    polymarketPluginPost.mockResolvedValueOnce(created);
    expect(await createOrDerivePolymarketApiCreds(input)).toEqual({ signerAddress, apiCreds });
    expect(polymarketPluginGet.mock.calls[2]).toEqual([`${gateway}/auth/derive-api-key`, { headers: await legacyHeaders(privateKey, 101) }]);
  });

  test("preserves custom gateway, input normalization and browser-only requests despite legacy server options", async () => {
    polymarketPluginGet.mockResolvedValueOnce(100);
    polymarketPluginPost.mockResolvedValueOnce({ key: 123, secret: 456, passphrase: 789 });
    const result = await createOrDerivePolymarketApiCreds({
      privateKey: `  ${privateKey.slice(2)}  `, walletAddress: `  ${signerAddress.toLowerCase()}  `,
      funder: "0x2222222222222222222222222222222222222222", gateway: " https://custom.example/clob/ ",
    }, { apiBase: "https://vps.example", authToken: "unused-legacy-token" });
    expect(result).toEqual({ signerAddress, apiCreds: { apiKey: "123", secret: "456", passphrase: "789" } });
    expect(polymarketPluginGet.mock.calls).toEqual([["https://custom.example/clob/time"]]);
    expect(polymarketPluginPost.mock.calls).toEqual([["https://custom.example/clob/auth/api-key", undefined, { headers: await legacyHeaders(privateKey, 100) }]]);
  });

  test("allows omitted wallet and a blank gateway", async () => {
    polymarketPluginGet.mockResolvedValueOnce(100);
    polymarketPluginPost.mockResolvedValueOnce(apiCreds);
    expect(await createOrDerivePolymarketApiCreds({ privateKey, gateway: " " })).toEqual({ signerAddress, apiCreds });
    expect(polymarketPluginGet).toHaveBeenCalledWith(`${gateway}/time`);
  });

  test.each([0, -1, "not-a-time", undefined, Infinity])("rejects invalid time %s without a credential request", async time => {
    polymarketPluginGet.mockResolvedValue(time);
    await expect(createOrDerivePolymarketApiCreds(input)).rejects.toThrow("Polymarket CLOB 未返回有效服务器时间");
    expect(polymarketPluginGet.mock.calls).toEqual([[`${gateway}/time`], [`${gateway}/time`]]);
    expect(polymarketPluginPost).not.toHaveBeenCalled();
  });

  test("retains fallback after the first clock request fails", async () => {
    polymarketPluginGet.mockRejectedValueOnce(new Error("clock unavailable"))
      .mockResolvedValueOnce(101).mockResolvedValueOnce(apiCreds);
    expect(await createOrDerivePolymarketApiCreds(input)).toEqual({ signerAddress, apiCreds });
    expect(polymarketPluginPost).not.toHaveBeenCalled();
    expect(polymarketPluginGet.mock.calls[2]).toEqual([`${gateway}/auth/derive-api-key`, { headers: await legacyHeaders(privateKey, 101) }]);
  });

  test("propagates derive transport errors", async () => {
    const error = new Error("derive unavailable");
    polymarketPluginPost.mockRejectedValueOnce(new Error("create unavailable"));
    polymarketPluginGet.mockResolvedValueOnce(100).mockResolvedValueOnce(101).mockRejectedValueOnce(error);
    await expect(createOrDerivePolymarketApiCreds(input)).rejects.toBe(error);
  });

  test("rejects incomplete derived credentials", async () => {
    polymarketPluginPost.mockResolvedValueOnce(undefined);
    polymarketPluginGet.mockResolvedValueOnce(100).mockResolvedValueOnce(101).mockResolvedValueOnce({ key: "incomplete" });
    await expect(createOrDerivePolymarketApiCreds(input)).rejects.toThrow("Polymarket 未返回有效 API 凭证");
  });

  test.each([
    { value: { ...input, privateKey: "invalid" }, error: "Polymarket 私钥格式不正确" },
    { value: { ...input, walletAddress: "0x2222222222222222222222222222222222222222" }, error: "与填写的钱包地址不一致" },
  ])("rejects key/wallet before HTTP: $error", async ({ value, error }) => {
    await expect(createOrDerivePolymarketApiCreds(value)).rejects.toThrow(error);
    expect(polymarketPluginGet).not.toHaveBeenCalled();
    expect(polymarketPluginPost).not.toHaveBeenCalled();
  });
});
