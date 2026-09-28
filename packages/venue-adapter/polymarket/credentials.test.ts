import { beforeEach, describe, expect, test, vi } from "vitest";

const createL1Headers = vi.hoisted(() => vi.fn());
const polymarketPluginGet = vi.hoisted(() => vi.fn());
const polymarketPluginPost = vi.hoisted(() => vi.fn());

vi.mock("@polymarket/clob-client-v2", () => ({
  Chain: { POLYGON: 137 },
  createL1Headers,
}));

vi.mock("viem", () => ({
  createWalletClient: vi.fn(() => ({ signer: true })),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({ address: "0x1111111111111111111111111111111111111111" })),
}));

vi.mock("./polygonRpc", () => ({
  createPolygonHttpTransport: vi.fn(() => ({ transport: true })),
  polygonChainForRpc: vi.fn(() => ({ id: 137 })),
}));

vi.mock("./transport", () => ({
  polymarketPluginGet,
  polymarketPluginPost,
}));

import { createOrDerivePolymarketApiCreds } from "./credentials";

describe("Polymarket L1 credentials", () => {
  beforeEach(() => {
    createL1Headers.mockReset();
    polymarketPluginGet.mockReset();
    polymarketPluginPost.mockReset();
    createL1Headers
      .mockResolvedValueOnce({
        POLY_ADDRESS: "0x1111111111111111111111111111111111111111",
        POLY_SIGNATURE: "create-signature",
        POLY_TIMESTAMP: "100",
        POLY_NONCE: "0",
      })
      .mockResolvedValueOnce({
        POLY_ADDRESS: "0x1111111111111111111111111111111111111111",
        POLY_SIGNATURE: "derive-signature",
        POLY_TIMESTAMP: "101",
        POLY_NONCE: "0",
      });
  });

  test("uses CLOB server time and re-signs derive after create failure", async () => {
    polymarketPluginGet
      .mockResolvedValueOnce("100")
      .mockResolvedValueOnce("101")
      .mockResolvedValueOnce({ apiKey: "key", secret: "secret", passphrase: "pass" });
    polymarketPluginPost.mockRejectedValueOnce(new Error("Could not create api key"));

    const result = await createOrDerivePolymarketApiCreds({
      privateKey: `0x${"1".repeat(64)}`,
      walletAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(result.apiCreds).toEqual({ apiKey: "key", secret: "secret", passphrase: "pass" });
    expect(createL1Headers).toHaveBeenNthCalledWith(1, expect.anything(), 137, undefined, 100);
    expect(createL1Headers).toHaveBeenNthCalledWith(2, expect.anything(), 137, undefined, 101);
    expect(polymarketPluginGet).toHaveBeenNthCalledWith(1, "https://clob.polymarket.com/time");
    expect(polymarketPluginGet).toHaveBeenNthCalledWith(2, "https://clob.polymarket.com/time");
    expect(polymarketPluginGet).toHaveBeenNthCalledWith(
      3,
      "https://clob.polymarket.com/auth/derive-api-key",
      { headers: expect.objectContaining({ POLY_SIGNATURE: "derive-signature", POLY_NONCE: "0" }) },
    );
  });
});
