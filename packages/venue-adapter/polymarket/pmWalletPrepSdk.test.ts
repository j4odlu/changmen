import { afterEach, describe, expect, test, vi } from "vitest";

const createSecureClient = vi.hoisted(() => vi.fn());
const remoteBuilderSigning = vi.hoisted(() => vi.fn((cfg: unknown) => cfg));
const privateKey = vi.hoisted(() => vi.fn(() => ({ kind: "signer" })));
const setupTradingApprovals = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@polymarket/client", () => ({
  createSecureClient,
  remoteBuilderSigning,
  forkEnvironmentConfig: (fork: Record<string, unknown>) => ({
    name: "production",
    chainId: 137,
    ...fork,
  }),
}));

vi.mock("@polymarket/client/viem", () => ({
  privateKey,
}));

import {
  resolvePmWalletPrepSdk,
  setPmWalletPrepSdkForTests,
} from "./pmWalletPrepSdk";
import { preparePolymarketWalletUnified } from "./walletPrepUnified";

afterEach(() => {
  setPmWalletPrepSdkForTests(null);
  createSecureClient.mockReset();
  remoteBuilderSigning.mockClear();
  privateKey.mockClear();
  setupTradingApprovals.mockReset();
});

describe("resolvePmWalletPrepSdk", () => {
  test("defaults to legacy", () => {
    expect(resolvePmWalletPrepSdk()).toBe("legacy");
  });

  test("test override selects unified", () => {
    setPmWalletPrepSdkForTests("unified");
    expect(resolvePmWalletPrepSdk()).toBe("unified");
  });
});

describe("preparePolymarketWalletUnified", () => {
  test("admits a Cookie session without JWT and configures Cookie/CSRF for remote signing", async () => {
    createSecureClient.mockResolvedValue({ account: { wallet: "wallet" }, setupTradingApprovals });
    const getAuthHeaders = vi.fn().mockResolvedValue({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" });
    const result = await preparePolymarketWalletUnified({
      privateKey: `0x${"11".repeat(32)}`, signUrl: "https://api.changmen.fun/api/polymarket/relayer/sign", getAuthHeaders, signatureType: 3,
    });
    expect(result.ok).toBe(true);
    const config = remoteBuilderSigning.mock.calls[0][0] as { credentials: string; headers: () => Promise<Record<string, string>> };
    expect(config.credentials).toBe("include");
    expect(await config.headers()).toEqual({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" });
  });
  test("rejects Safe/Proxy signature types", async () => {
    const result = await preparePolymarketWalletUnified({
      privateKey: `0x${"11".repeat(32)}`,
      signUrl: "https://example.com/api/polymarket/relayer/sign",
      authToken: "tok",
      signatureType: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/signatureType=3/);
    expect(createSecureClient).not.toHaveBeenCalled();
  });

  test("deploys via createSecureClient + setupTradingApprovals", async () => {
    createSecureClient.mockResolvedValue({
      account: { wallet: "0xDepositWallet11111111111111111111111111" },
      setupTradingApprovals,
    });

    const result = await preparePolymarketWalletUnified({
      privateKey: `0x${"11".repeat(32)}`,
      signUrl: "https://example.com/api/polymarket/relayer/sign",
      authToken: "tok",
      signatureType: 3,
      relayerUrl: "https://relayer-custom.example.com",
      credentials: {
        key: "k",
        secret: "s",
        passphrase: "p",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.funder).toBe("0xDepositWallet11111111111111111111111111");
    expect(createSecureClient).toHaveBeenCalledTimes(1);
    expect(setupTradingApprovals).toHaveBeenCalledTimes(1);
    expect(remoteBuilderSigning).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://example.com/api/polymarket/relayer/sign",
    }));
    const secureOpts = createSecureClient.mock.calls[0]?.[0] as {
      credentials?: { key: string };
      environment?: { rpc?: string; relayer?: { rest?: string } };
    };
    expect(secureOpts.credentials?.key).toBe("k");
    expect(secureOpts.environment?.relayer?.rest).toBe("https://relayer-custom.example.com");
    expect(String(secureOpts.environment?.rpc || "")).toMatch(/^https?:\/\//);
  });

  test("maps CLOB/network failures to actionable message", async () => {
    createSecureClient.mockRejectedValue(new Error("Failed to fetch"));
    const result = await preparePolymarketWalletUnified({
      privateKey: `0x${"11".repeat(32)}`,
      signUrl: "https://example.com/api/polymarket/relayer/sign",
      authToken: "tok",
      signatureType: 3,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/可达 CLOB/);
    expect(result.message).toMatch(/legacy/);
  });
});
