import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import {
  applyPmVaultBalanceGate,
  pmAccountShowsUnlockPending,
  refreshPmVaultAccountUi,
  resetPmVaultAccountUi,
} from "./accountUiStatus";

vi.mock("./store", () => ({
  listVaultKeys: vi.fn(async () => [{ accountId: 42 }]),
}));

vi.mock("./session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session")>();
  return {
    ...actual,
    hasVault: vi.fn(async (uid: string) => Boolean(uid)),
    isPmVaultUnlocked: vi.fn(() => false),
    getCachedPrivateKey: vi.fn(() => undefined),
    pmVaultSessionRev: actual.pmVaultSessionRev,
  };
});

describe("pmAccountShowsUnlockPending", () => {
  it("checks wallet binding when deciding whether an account needs unlock", async () => {
    const { getCachedPrivateKey } = await import("./session");
    const walletAddress = `0x${"2".repeat(40)}`;
    const account = new PlatformAccount({ accountId: 42, provider: "Polymarket", token: JSON.stringify({ walletAddress }) });
    await refreshPmVaultAccountUi([account], "u1");
    vi.mocked(getCachedPrivateKey).mockImplementation((_id, wallet) => wallet === `0x${"1".repeat(40)}` ? "old-key" : undefined);
    expect(pmAccountShowsUnlockPending(account)).toBe(true);
    expect(getCachedPrivateKey).toHaveBeenCalledWith(42, walletAddress);
  });
  beforeEach(async () => {
    resetPmVaultAccountUi();
    const { getCachedPrivateKey, isPmVaultUnlocked } = await import("./session");
    vi.mocked(isPmVaultUnlocked).mockReturnValue(false);
    vi.mocked(getCachedPrivateKey).mockReturnValue(undefined);
  });

  it("非 Polymarket 账号不显示", async () => {
    await refreshPmVaultAccountUi(
      [new PlatformAccount({ accountId: 1, provider: "RAY" })],
      "u1",
    );
    expect(pmAccountShowsUnlockPending(
      new PlatformAccount({ accountId: 1, provider: "RAY" }),
    )).toBe(false);
  });

  it("本机仓存在、未解锁、仓内有钥 → 显示待解锁", async () => {
    await refreshPmVaultAccountUi(
      [new PlatformAccount({ accountId: 42, provider: "Polymarket", token: "{}" })],
      "u1",
    );
    expect(pmAccountShowsUnlockPending(
      new PlatformAccount({ accountId: 42, provider: "Polymarket", token: "{}" }),
    )).toBe(true);
  });

  it("token 内仍有明文私钥时不显示", async () => {
    const pk = `0x${"ab".repeat(32)}`;
    await refreshPmVaultAccountUi(
      [new PlatformAccount({
        accountId: 42,
        provider: "Polymarket",
        token: JSON.stringify({ privateKey: pk }),
      })],
      "u1",
    );
    expect(pmAccountShowsUnlockPending(
      new PlatformAccount({
        accountId: 42,
        provider: "Polymarket",
        token: JSON.stringify({ privateKey: pk }),
      }),
    )).toBe(false);
  });

  it("已解锁且内存有钥时不显示", async () => {
    const { getCachedPrivateKey, isPmVaultUnlocked } = await import("./session");
    vi.mocked(isPmVaultUnlocked).mockReturnValue(true);
    vi.mocked(getCachedPrivateKey).mockReturnValue(`0x${"ab".repeat(32)}`);
    await refreshPmVaultAccountUi(
      [new PlatformAccount({ accountId: 42, provider: "Polymarket", token: "{}" })],
      "u1",
    );
    expect(pmAccountShowsUnlockPending(
      new PlatformAccount({ accountId: 42, provider: "Polymarket", token: "{}" }),
      "u1",
    )).toBe(false);
  });
});

describe("applyPmVaultBalanceGate", () => {
  beforeEach(async () => {
    resetPmVaultAccountUi();
    const { getCachedPrivateKey, isPmVaultUnlocked } = await import("./session");
    vi.mocked(isPmVaultUnlocked).mockReturnValue(false);
    vi.mocked(getCachedPrivateKey).mockReturnValue(undefined);
  });

  it("待解锁 PM 清空 balance", async () => {
    const acc = new PlatformAccount({ accountId: 42, provider: "Polymarket", token: "{}" });
    acc.balance = 99;
    await refreshPmVaultAccountUi([acc], "u1");
    expect(pmAccountShowsUnlockPending(acc, "u1")).toBe(true);
    expect(acc.balance).toBeUndefined();
    expect(acc.balanceStale).toBe(false);
  });

  it("已解锁 PM 保留 balance", async () => {
    const { getCachedPrivateKey, isPmVaultUnlocked } = await import("./session");
    vi.mocked(isPmVaultUnlocked).mockReturnValue(true);
    vi.mocked(getCachedPrivateKey).mockReturnValue(`0x${"ab".repeat(32)}`);
    const acc = new PlatformAccount({ accountId: 42, provider: "Polymarket", token: "{}" });
    acc.balance = 99;
    applyPmVaultBalanceGate([acc], "u1");
    expect(acc.balance).toBe(99);
  });
});

describe("refreshPmVaultAccountUi", () => {
  beforeEach(() => {
    resetPmVaultAccountUi();
  });

  it("空 userId 清空状态", async () => {
    await refreshPmVaultAccountUi([], "");
    expect(pmAccountShowsUnlockPending(
      new PlatformAccount({ accountId: 42, provider: "Polymarket" }),
    )).toBe(false);
  });
});
