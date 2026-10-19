import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";

import { resolvePredictFunPrivyAddressFromPrivateKey } from "./credentials";
import { predictFunUsdtFromWei } from "./userSession";

describe("resolvePredictFunPrivyAddressFromPrivateKey", () => {
  it("derives EOA from Privy private key", () => {
    const pk = `0x${"22".repeat(32)}`;
    expect(resolvePredictFunPrivyAddressFromPrivateKey(pk)).toBe(new Wallet(pk).address);
    expect(resolvePredictFunPrivyAddressFromPrivateKey("")).toBe("");
    expect(resolvePredictFunPrivyAddressFromPrivateKey("not-a-key")).toBe("");
  });
});

describe("predictFunUsdtFromWei", () => {
  it("converts 18-decimal wei to USDT with 2dp", () => {
    expect(predictFunUsdtFromWei(0n)).toBe(0);
    expect(predictFunUsdtFromWei(1_060_000_000_000_000_000n)).toBe(1.06);
    expect(predictFunUsdtFromWei(100_000_000_000_000_000n)).toBe(0.1);
  });
});

describe("resolvePredictFunUserCredentials", () => {
  it("requires privy key and predict account", async () => {
    const { resolvePredictFunUserCredentials } = await import("./userSession");
    expect(() => resolvePredictFunUserCredentials({
      accountId: 1,
      token: JSON.stringify({ predictAccount: `0x${"11".repeat(20)}` }),
    } as never)).toThrow(/Privy/);

    expect(() => resolvePredictFunUserCredentials({
      accountId: 1,
      token: JSON.stringify({ privyPrivateKey: `0x${"22".repeat(32)}` }),
    } as never)).toThrow(/智能钱包/);

    const ok = resolvePredictFunUserCredentials({
      accountId: 1,
      token: JSON.stringify({
        privyPrivateKey: `0x${"22".repeat(32)}`,
        predictAccount: `0x${"11".repeat(20)}`,
      }),
    } as never);
    expect(ok.predictAccount).toBe(`0x${"11".repeat(20)}`);
    expect(ok.privyPrivateKey).toBe(`0x${"22".repeat(32)}`);
  });
});

describe("predictFunProvider.getBalance", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads chain USDT via user session and returns USDT", async () => {
    const getJwt = vi.fn(async () => "jwt");
    const balanceOf = vi.fn(async () => 1_060_000_000_000_000_000n);
    vi.doMock("./userSession", async () => {
      const actual = await vi.importActual<typeof import("./userSession")>("./userSession");
      return {
        ...actual,
        preparePredictFunUserSession: vi.fn(async () => ({
          orderBuilder: { balanceOf },
          maker: `0x${"aa".repeat(20)}`,
          privyAddress: `0x${"bb".repeat(20)}`,
          getJwt,
        })),
      };
    });
    const { predictFunProvider } = await import("./bet");
    const out = await predictFunProvider.getBalance!({
      accountId: 1,
      provider: "PredictFun",
      token: JSON.stringify({
        privyPrivateKey: `0x${"22".repeat(32)}`,
        predictAccount: `0x${"aa".repeat(20)}`,
      }),
    } as never);
    expect(out).toEqual({
      balance: 1.06,
      currency: "USDT",
      venueMemberId: `0x${"aa".repeat(20)}`,
      venueAccountName: `0x${"aa".repeat(20)}`,
    });
    expect(balanceOf).toHaveBeenCalledWith("USDT", `0x${"aa".repeat(20)}`);
    expect(getJwt).toHaveBeenCalled();
  });
});
