import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@/models/platformAccount";
const mocks = vi.hoisted(() => ({ meta: { userId: "u", saltB64: "AA==", iterations: 1 },
  rows: [{ accountId: 12, walletAddress: `0x${"1".repeat(40)}`, cipher: { ivB64: "iv", ctB64: "pm" } },
    { accountId: 13, walletAddress: `0x${"2".repeat(40)}`, cipher: { ivB64: "iv", ctB64: "pf" } }], send: vi.fn(), derive: vi.fn() }));
vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({ a8PluginSend: mocks.send }));
vi.mock("@/lib/authSession", () => ({ getToken: () => "token", getAuthSessionVersion: () => "login-1", isAuthSessionCurrent: () => true }));
vi.mock("./crypto", () => ({ deriveKek: mocks.derive, base64ToBytes: () => new Uint8Array(), verifyKek: async () => true,
  decryptUtf8: async (_key: unknown, cipher: { ctB64: string }) => `0x${(cipher.ctB64 === "pm" ? "ab" : "cd").repeat(32)}`,
  bytesToBase64: vi.fn(), createVerifier: vi.fn(), encryptUtf8: vi.fn(), randomBytes: vi.fn() }));
vi.mock("./store", () => ({ getVaultMeta: async () => mocks.meta, listVaultKeys: async () => mocks.rows, hasVault: async () => true,
  defaultMetaIterations: () => 1, defaultMetaVersion: () => 1, getVaultKey: vi.fn(), putVaultKey: vi.fn(), putVaultMeta: vi.fn(),
  replaceVaultPasswordAtomic: vi.fn(), vaultKeyId: vi.fn() }));
vi.mock("./accountUiStatus", () => ({ touchPmVaultAccountUiSession: vi.fn(), refreshPmVaultAccountUiFromStore: vi.fn() }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: [] }) }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ clearPolymarketOrderClientCache: vi.fn() }));
import { completePmVaultUnlock, ensurePmVaultForAccounts, getCachedPrivateKey, isPmVaultUnlocked, lockPmVault, pmVaultUi, unlockPmVault, putPrivateKeyInVault } from "./session";
import { retainedPmSessionUi, revokeRetainedPmSession } from "./retainedPmSession";
function account(provider: string, id: number): PlatformAccount {
  return { provider, accountId: id, token: JSON.stringify({ walletAddress: mocks.rows[id === 12 ? 0 : 1].walletAddress }) } as PlatformAccount;
}
beforeEach(() => {
  lockPmVault({ preservePmSession: true }); vi.clearAllMocks(); retainedPmSessionUi.enabled = true;
  mocks.derive.mockResolvedValue({});
  mocks.send.mockResolvedValue({ ok: true, revision: "r", lockHandle: "l", expiresAt: Date.now() + 3600000,
    entries: [{ accountId: 12, walletAddress: mocks.rows[0].walletAddress, privateKey: `0x${"ab".repeat(32)}`,
      binding: JSON.stringify([mocks.meta, mocks.rows[0]]) }] });
});
afterEach(() => lockPmVault({ preservePmSession: true }));
describe("shared vault / PM recovery separation", () => {
  it.each(["full-vault", "retained"])("%s readiness checks the current wallet and rejects a mismatch even after password unlock", async mode => {
    if (mode === "full-vault") await unlockPmVault("u", "password");
    else await ensurePmVaultForAccounts("u", [account("Polymarket", 12)]);
    const changed = account("Polymarket", 12);
    changed.token = JSON.stringify({ walletAddress: mocks.rows[1].walletAddress });
    const waiting = ensurePmVaultForAccounts("u", [changed]);
    await vi.waitFor(() => expect(pmVaultUi.needUnlock).toBe(true));
    await unlockPmVault("u", "password");
    completePmVaultUnlock(true);
    expect(await waiting).toBe(false);
    expect(getCachedPrivateKey(12, mocks.rows[1].walletAddress)).toBeUndefined();
  });
  it("full vault and retained keys reject a changed wallet address", async () => {
    await ensurePmVaultForAccounts("u", [account("Polymarket", 12)]);
    expect(getCachedPrivateKey(12, mocks.rows[1].walletAddress)).toBeUndefined();
    await unlockPmVault("u", "password");
    expect(getCachedPrivateKey(12, mocks.rows[1].walletAddress)).toBeUndefined();
    expect(getCachedPrivateKey(12, mocks.rows[0].walletAddress)).toBe(`0x${"ab".repeat(32)}`);
  });
  it("replacement reads the new key and does not reuse the old retained key", async () => {
    await ensurePmVaultForAccounts("u", [account("Polymarket", 12)]);
    await unlockPmVault("u", "password");
    const replacement = `0x${"ef".repeat(32)}`;
    await putPrivateKeyInVault("u", 12, replacement, mocks.rows[0].walletAddress);
    expect(getCachedPrivateKey(12)).toBe(replacement);
    expect(getCachedPrivateKey(13)).toBe(`0x${"cd".repeat(32)}`);
  });
  it("PM recovery avoids password without marking the shared vault unlocked", async () => {
    expect(await ensurePmVaultForAccounts("u", [account("Polymarket", 12)])).toBe(true);
    expect(isPmVaultUnlocked("u")).toBe(false);
    expect(getCachedPrivateKey(12)).toBe(`0x${"ab".repeat(32)}`);
    expect(getCachedPrivateKey(13)).toBeUndefined();
    expect(mocks.derive).not.toHaveBeenCalled();
  });
  it("a PredictFun account still needs password unlock", async () => {
    const waiting = ensurePmVaultForAccounts("u", [account("Polymarket", 12), account("PredictFun", 13)]);
    await vi.waitFor(() => expect(pmVaultUi.needUnlock).toBe(true));
    completePmVaultUnlock(false);
    expect(await waiting).toBe(false);
    expect(getCachedPrivateKey(13)).toBeUndefined();
  });
  it("locking PM clears its full-vault key but preserves PF; next PM use prompts password", async () => {
    const pm = account("Polymarket", 12);
    await unlockPmVault("u", "password");
    expect(getCachedPrivateKey(13)).toBe(`0x${"cd".repeat(32)}`);
    await ensurePmVaultForAccounts("u", [pm]);
    await revokeRetainedPmSession("u");
    mocks.send.mockResolvedValue({ ok: true, revision: "locked", expiresAt: 0, entries: [] });
    expect(getCachedPrivateKey(12)).toBeUndefined();
    expect(getCachedPrivateKey(13)).toBe(`0x${"cd".repeat(32)}`);
    const waiting = ensurePmVaultForAccounts("u", [pm]);
    await vi.waitFor(() => expect(pmVaultUi.needUnlock).toBe(true));
    completePmVaultUnlock(false);
    expect(await waiting).toBe(false);
  });
});
