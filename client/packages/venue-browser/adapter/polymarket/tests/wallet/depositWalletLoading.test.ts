import { afterEach, expect, test, vi } from "vitest";

vi.mock("@changmen/venue-browser/polymarket/wallet/walletPrepUnified", () => ({
  preparePolymarketWalletUnified: async () => ({ ok: true, funder: "deposit-wallet" }),
}));

import { derivePolymarketDepositWalletAddress, resolvePolymarketDepositWalletFromPrivateKey } from "@changmen/venue-browser/polymarket/wallet/depositWallet";
import { preparePolymarketWallet } from "@changmen/venue-browser/polymarket/wallet/relayer";

afterEach(() => vi.restoreAllMocks());
test("Deposit Wallet address and unified preparation work without importing either legacy SDK", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    expect(request.method).toBe("eth_call");
    return Response.json({ jsonrpc: "2.0", id: request.id, result: `0x${"0".repeat(64)}` });
  });
  const privateKey = `0x${"2".repeat(64)}`;
  const funder = await derivePolymarketDepositWalletAddress({ privateKey });
  expect(await resolvePolymarketDepositWalletFromPrivateKey({ privateKey })).toEqual({
    walletAddress: "0x1563915e194D8CfBA1943570603F7606A3115508", funder,
  });
  expect(await preparePolymarketWallet({ privateKey, signUrl: "https://app.test/relayer/sign", signatureType: 3 }))
    .toEqual({ ok: true, funder: "deposit-wallet" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
