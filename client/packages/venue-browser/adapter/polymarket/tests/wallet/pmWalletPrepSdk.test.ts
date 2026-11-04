import { afterEach, describe, expect, test, vi } from "vitest";

const createSecureClient = vi.hoisted(() => vi.fn());
const remoteBuilderSigning = vi.hoisted(() => vi.fn((cfg: unknown) => cfg));
const privateKey = vi.hoisted(() => vi.fn(() => ({ kind: "signer" })));
const setupTradingApprovals = vi.hoisted(() => vi.fn(async () => undefined));
const updateBalanceAllowance = vi.hoisted(() => vi.fn(async (_client: unknown, _request: unknown): Promise<{ allowances: Record<string, bigint> }> => ({ allowances: {
  "0xe111180000d2663c0091e4f400237545b87b996b": 1n,
  "0xe2222d279d744050d28e00520010520000310f59": 1n,
  "0xe3333700ca9d93003f00f0f71f8515005f6c00aa": 1n,
} })));
vi.mock("@polymarket/client/actions", () => ({ updateBalanceAllowance }));
const ensureCtfNegRiskApprovals = vi.hoisted(() => vi.fn(async (_client: unknown) => undefined));
vi.mock("../../../../polymarket/wallet/ctfNegRiskApprovals", () => ({ ensureCtfNegRiskApprovals }));

vi.mock("@polymarket/client", () => ({
  createSecureClient,
  remoteBuilderSigning,
  forkEnvironmentConfig: (fork: Record<string, unknown>) => ({
    name: "production",
    chainId: 137,
    ...fork,
  }),
  AssetType: { COLLATERAL: "COLLATERAL" },
}));

vi.mock("@polymarket/client/viem", () => ({
  privateKey,
}));

import {
  resolvePmWalletPrepSdk,
  setPmWalletPrepSdkForTests,
} from "@changmen/venue-browser/polymarket/wallet/pmWalletPrepSdk";
import { preparePolymarketWalletUnified } from "@changmen/venue-browser/polymarket/wallet/walletPrepUnified";
import { preparePolymarketWallet } from "@changmen/venue-browser/polymarket/wallet/relayer";

afterEach(() => {
  vi.unstubAllGlobals();
  setPmWalletPrepSdkForTests(null);
  createSecureClient.mockReset();
  remoteBuilderSigning.mockClear();
  privateKey.mockClear();
  setupTradingApprovals.mockReset();
  updateBalanceAllowance.mockReset();
  ensureCtfNegRiskApprovals.mockReset();
});

describe("resolvePmWalletPrepSdk", () => {
  test("defaults to unified", () => {
    expect(resolvePmWalletPrepSdk()).toBe("unified");
  });

  test("test override selects unified", () => {
    setPmWalletPrepSdkForTests("unified");
    expect(resolvePmWalletPrepSdk()).toBe("unified");
  });
  test("ignores retired legacy settings", () => {
    setPmWalletPrepSdkForTests("legacy");
    expect(resolvePmWalletPrepSdk()).toBe("unified");
  });
  test("the default entry prepares Deposit Wallet through the official unified SDK", async () => {
    createSecureClient.mockResolvedValue({ account: { wallet: "deposit-wallet" }, setupTradingApprovals });
    setPmWalletPrepSdkForTests("legacy");
    vi.stubGlobal("localStorage", { getItem: () => "legacy" });
    const result = await preparePolymarketWallet({
      privateKey: `0x${"11".repeat(32)}`,
      signUrl: "https://api.changmen.fun/api/polymarket/relayer/sign",
      getAuthHeaders: async () => ({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" }),
      signatureType: 3,
    });
    expect(result).toMatchObject({ ok: true, funder: "deposit-wallet" });
    expect(createSecureClient).toHaveBeenCalledOnce();
    expect(setupTradingApprovals).toHaveBeenCalledOnce();
    expect(updateBalanceAllowance).toHaveBeenCalledExactlyOnceWith(await createSecureClient.mock.results[0].value, { assetType: "COLLATERAL" });
    expect(updateBalanceAllowance.mock.invocationCallOrder[0]).toBeGreaterThan(ensureCtfNegRiskApprovals.mock.invocationCallOrder[0]!);
    expect(ensureCtfNegRiskApprovals).toHaveBeenCalledWith(await createSecureClient.mock.results[0].value);
  });
});

describe("preparePolymarketWalletUnified", () => {
  test("does not report ready when supplemental CTF approvals fail", async () => {
    createSecureClient.mockResolvedValue({ account: { wallet: "wallet" }, setupTradingApprovals });
    ensureCtfNegRiskApprovals.mockRejectedValueOnce(new Error("CTF 负风险适配器授权尚未确认"));
    const result = await preparePolymarketWalletUnified({
      privateKey: `0x${"11".repeat(32)}`, signUrl: "https://example.com/sign", authToken: "tok", signatureType: 3,
    });
    expect(result).toMatchObject({ ok: false, message: "CTF 负风险适配器授权尚未确认" });
    expect(updateBalanceAllowance).not.toHaveBeenCalled();
  });
  test("does not report ready if the CLOB allowance refresh fails", async () => {
    createSecureClient.mockResolvedValue({ account: { wallet: "wallet" }, setupTradingApprovals });
    updateBalanceAllowance.mockRejectedValueOnce(new Error("allowance cache refresh failed"));
    const result = await preparePolymarketWalletUnified({ privateKey: `0x${"11".repeat(32)}`, signUrl: "https://example.com/sign", authToken: "tok" });
    expect(result).toMatchObject({ ok: false, message: "allowance cache refresh failed" });
  });
  test.each([{}, { "0xe3333700ca9d93003f00f0f71f8515005f6c00aa": 0n }])("does not report ready for an empty or stale allowance cache (%#)", async allowances => {
    createSecureClient.mockResolvedValue({ account: { wallet: "wallet" }, setupTradingApprovals });
    updateBalanceAllowance.mockResolvedValueOnce({ allowances });
    const result = await preparePolymarketWalletUnified({ privateKey: `0x${"11".repeat(32)}`, signUrl: "https://example.com/sign", authToken: "tok" });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("授权缓存尚未同步");
  });
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
    expect(result.message).not.toMatch(/legacy/);
  });
});
