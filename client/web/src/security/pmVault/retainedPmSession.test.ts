import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@/models/platformAccount";
const mocks = vi.hoisted(() => ({ send: vi.fn(), meta: { userId: "u", updatedAt: 1 },
  row: { accountId: 12, cipher: { ivB64: "iv", ctB64: "ct" } },
  version: "login-1", clear: vi.fn(), extraRows: [] as Array<{ accountId: number; cipher: { ivB64: string; ctB64: string } }> }));
const storageHooks = vi.hoisted(() => {
  const hooks: Array<(event: { key: string; newValue: string | null }) => void> = [];
  vi.stubGlobal("window", { addEventListener: (name: string, handler: (event: { key: string; newValue: string | null }) => void) => {
    if (name === "storage") hooks.push(handler);
  } });
  return hooks;
});
vi.mock("./session", () => ({ isPmVaultUnlocked: () => false, getCachedPrivateKey: vi.fn(), putPrivateKeyInVault: vi.fn() }));
import { mergeVaultKeysIntoAccounts } from "./accounts";
vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({ a8PluginSend: mocks.send }));
vi.mock("@/lib/authSession", () => ({ getToken: () => "test-token", getAuthSessionVersion: () => mocks.version,
  isAuthSessionCurrent: (version: string) => version === mocks.version }));
vi.mock("./store", () => ({ getVaultMeta: async () => mocks.meta, listVaultKeys: async () => [mocks.row, ...mocks.extraRows] }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ clearPolymarketOrderClientCache: mocks.clear }));
import { clearRetainedPmMemory, getRetainedPmPrivateKey, prepareRetainedPmSession, registerRetainedPmCleanup,
  restoreRetainedPmSession, retainedPmSessionUi, revokeRetainedPmSession, saveRetainedPmSession, setRetainedPmHours, removeRetainedPmAccount } from "./retainedPmSession";
const pk = `0x${"ab".repeat(32)}`;
const walletAddress = `0x${"1".repeat(40)}`;
function account(provider = "Polymarket", id = 12): PlatformAccount {
  return { provider, accountId: id, token: JSON.stringify({ walletAddress }), balance: 100 } as PlatformAccount;
}
function reply() { return { ok: true, revision: "revision-1", lockHandle: "revoke-only", expiresAt: Date.now() + 3600000,
  entries: [{ accountId: 12, walletAddress, privateKey: pk, binding: JSON.stringify([mocks.meta, mocks.row]) }] }; }
beforeEach(() => {
  clearRetainedPmMemory();
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.clearAllMocks();
  mocks.version = "login-1";
  mocks.extraRows = [];
  retainedPmSessionUi.enabled = true;
  retainedPmSessionUi.hours = 0;
  retainedPmSessionUi.error = "";
  retainedPmSessionUi.lockPending = false;
});
afterEach(() => { clearRetainedPmMemory(); localStorage.clear(); vi.clearAllTimers(); vi.useRealTimers(); });
describe("PM-only session recovery", () => {
  it("explains missing login credentials separately from a revoked session", async () => {
    mocks.send.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED" });
    expect(await restoreRetainedPmSession([account()], "u")).toBe(false);
    expect(retainedPmSessionUi.error).toContain("插件未取得登录凭证");
    expect(retainedPmSessionUi.error).not.toContain("请重新登录并解锁");
  });
  it.each(["local", "other-tab"])("%s removal during an in-flight poll preserves checks for remaining accounts", async source => {
    const secondRow = { ...mocks.row, accountId: 14 };
    mocks.extraRows = [secondRow];
    const second = { ...reply().entries[0], accountId: 14, binding: JSON.stringify([mocks.meta, secondRow]) };
    const healthy = { ...reply(), expiresAt: -1, entries: [...reply().entries, second] };
    mocks.send.mockResolvedValueOnce(healthy);
    await restoreRetainedPmSession([account(), account("Polymarket", 14)], "u");
    let release!: () => void;
    mocks.send.mockImplementation(message => {
      if (message.type === "pmWalletSession:remove") return Promise.resolve({ ok: true, revision: "removed" });
      return new Promise(resolve => { release = () => resolve({ ...healthy, revision: "removed", entries: [second] }); });
    });
    await vi.advanceTimersByTimeAsync(15000);
    expect(release).toBeTypeOf("function");
    if (source === "local") await removeRetainedPmAccount("u", 12);
    else for (const hook of storageHooks) hook({ key: "changmen:pm-session-lock", newValue: JSON.stringify({ userId: "u", accountId: 12 }) });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(getRetainedPmPrivateKey(14)).toBe(pk);
    mocks.send.mockResolvedValue({ ok: false, code: "SESSION_REVOKED" });
    await vi.advanceTimersByTimeAsync(15000);
    expect(getRetainedPmPrivateKey(14)).toBeUndefined();
  });
  it("old account references cannot authorize recovery for a changed wallet", async () => {
    mocks.send.mockResolvedValue({ ...reply(), expiresAt: -1 });
    const original = account();
    await restoreRetainedPmSession([original], "u");
    const changed = account();
    changed.token = JSON.stringify({ walletAddress: `0x${"2".repeat(40)}` });
    expect(await restoreRetainedPmSession([changed], "u")).toBe(false);
    expect(getRetainedPmPrivateKey(12, "u", `0x${"2".repeat(40)}`)).toBeUndefined();
    // Reusing a previously seen object must also update the current wallet binding.
    expect(await restoreRetainedPmSession([original], "u")).toBe(true);
    await revokeRetainedPmSession("u");
    expect(JSON.parse(original.token!).privateKey).toBeUndefined();
    expect(JSON.parse(changed.token!).privateKey).toBeUndefined();
  });
  it("an older lock acknowledgment cannot clear a newer pending lock", async () => {
    mocks.send.mockResolvedValue({ ...reply(), expiresAt: -1 });
    await restoreRetainedPmSession([account()], "u");
    let release!: () => void;
    let calls = 0;
    mocks.send.mockImplementation(() => {
      if (++calls === 1) return new Promise(resolve => { release = () => resolve({ ok: true }); });
      return Promise.resolve({ ok: true });
    });
    const first = revokeRetainedPmSession("u");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const second = revokeRetainedPmSession("u");
    release();
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(localStorage.getItem("changmen:pm-revoke-pending:u")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(15000);
    expect(localStorage.getItem("changmen:pm-revoke-pending:u")).toBeNull();
  });
  it("failed explicit lock blocks recovery across page cleanup and retries until confirmed", async () => {
    const healthy = { ...reply(), expiresAt: -1 };
    mocks.send.mockResolvedValue(healthy);
    await restoreRetainedPmSession([account()], "u");
    mocks.send.mockImplementation(message => Promise.resolve(message.type === "pmWalletSession:lock" ? { ok: false } : healthy));
    expect(await revokeRetainedPmSession("u")).toBe(false);
    expect(retainedPmSessionUi.lockPending).toBe(true);
    expect(retainedPmSessionUi.error).toContain("禁止会话恢复");
    expect(localStorage.getItem("changmen:pm-revoke-pending:u")).not.toBeNull();
    clearRetainedPmMemory();
    mocks.send.mockClear();
    expect(await restoreRetainedPmSession([account()], "u")).toBe(false);
    expect(mocks.send.mock.calls.every(([message]) => message.type === "pmWalletSession:lock")).toBe(true);
    expect(getRetainedPmPrivateKey(12)).toBeUndefined();
    mocks.send.mockResolvedValue({ ok: true, revision: "locked", expiresAt: 0, entries: [] });
    await vi.advanceTimersByTimeAsync(15000);
    expect(localStorage.getItem("changmen:pm-revoke-pending:u")).toBeNull();
    expect(retainedPmSessionUi.lockPending).toBe(false);
    expect(await restoreRetainedPmSession([account()], "u")).toBe(false);
  });
  it("wrong-wallet account loads cannot merge a retained private key", async () => {
    mocks.send.mockResolvedValue({ ...reply(), expiresAt: -1 });
    await restoreRetainedPmSession([account()], "u");
    const changed = account();
    changed.token = JSON.stringify({ walletAddress: `0x${"2".repeat(40)}` });
    expect(mergeVaultKeysIntoAccounts([changed], "u").merged).toBe(0);
    expect(JSON.parse(changed.token!).privateKey).toBeUndefined();
    expect(getRetainedPmPrivateKey(12, "u", walletAddress.toUpperCase())).toBe(pk);
    expect(getRetainedPmPrivateKey(12, "u", "")).toBeUndefined();
  });
  it("storage events synchronize both enabling and disabling, plus duration", () => {
    expect(storageHooks.length).toBeGreaterThan(0);
    for (const hook of storageHooks) hook({ key: "changmen:pm-session-enabled", newValue: "0" });
    expect(retainedPmSessionUi.enabled).toBe(false);
    for (const hook of storageHooks) hook({ key: "changmen:pm-session-enabled", newValue: "1" });
    expect(retainedPmSessionUi.enabled).toBe(true);
    for (const hook of storageHooks) hook({ key: "changmen:pm-session-hours", newValue: "24" });
    expect(retainedPmSessionUi.hours).toBe(24);
  });
  it("removing one PM account keeps another PM account unlocked", async () => {
    const secondRow = { ...mocks.row, accountId: 14 };
    mocks.extraRows = [secondRow];
    const second = { ...reply().entries[0], accountId: 14, binding: JSON.stringify([mocks.meta, secondRow]) };
    mocks.send.mockResolvedValueOnce({ ...reply(), expiresAt: -1, entries: [...reply().entries, second] })
      .mockResolvedValue({ ok: true, revision: "after-removal", expiresAt: -1, entries: [] });
    const firstAccount = account(); const secondAccount = account("Polymarket", 14);
    await restoreRetainedPmSession([firstAccount, secondAccount], "u");
    await removeRetainedPmAccount("u", 12);
    expect(getRetainedPmPrivateKey(12)).toBeUndefined();
    expect(getRetainedPmPrivateKey(14)).toBe(pk);
    expect(JSON.parse(firstAccount.token!).privateKey).toBeUndefined();
    expect(JSON.parse(secondAccount.token!).privateKey).toBe(pk);
    expect(retainedPmSessionUi.active).toBe(true);
  });
  it("ownership changes clear only the affected account during polling", async () => {
    const secondRow = { ...mocks.row, accountId: 14 };
    mocks.extraRows = [secondRow];
    const second = { ...reply().entries[0], accountId: 14, binding: JSON.stringify([mocks.meta, secondRow]) };
    mocks.send.mockResolvedValueOnce({ ...reply(), expiresAt: -1, entries: [...reply().entries, second] })
      .mockResolvedValue({ ...reply(), revision: "ownership-changed", expiresAt: -1, entries: [second] });
    await restoreRetainedPmSession([account(), account("Polymarket", 14)], "u");
    await vi.advanceTimersByTimeAsync(15000);
    expect(getRetainedPmPrivateKey(12)).toBeUndefined();
    expect(getRetainedPmPrivateKey(14)).toBe(pk);
  });
  it("browser-session recovery retains keys after days with no user interaction", async () => {
    mocks.send.mockResolvedValue({ ...reply(), expiresAt: -1 });
    const pm = account();
    expect(await restoreRetainedPmSession([pm], "u")).toBe(true);
    vi.setSystemTime(Date.now() + 7 * 24 * 3600000);
    await vi.advanceTimersByTimeAsync(15000);
    expect(getRetainedPmPrivateKey(12, "u")).toBe(pk);
    expect(retainedPmSessionUi.active).toBe(true);
  });
  it("temporary polling failures retain the current key and retry", async () => {
    const healthy = { ...reply(), expiresAt: -1 };
    mocks.send.mockResolvedValueOnce(healthy).mockResolvedValueOnce({ ok: false, code: "AUTH_UNAVAILABLE" }).mockResolvedValue(healthy);
    await restoreRetainedPmSession([account()], "u");
    await vi.advanceTimersByTimeAsync(15000);
    expect(getRetainedPmPrivateKey(12, "u")).toBe(pk);
    expect(retainedPmSessionUi.error).not.toBe("");
    await vi.advanceTimersByTimeAsync(15000);
    expect(getRetainedPmPrivateKey(12, "u")).toBe(pk);
    expect(retainedPmSessionUi.error).toBe("");
  });
  it("confirmed revocation clears an indefinite page session", async () => {
    mocks.send.mockResolvedValueOnce({ ...reply(), expiresAt: -1 }).mockResolvedValue({ ok: false, code: "SESSION_REVOKED" });
    await restoreRetainedPmSession([account()], "u");
    await vi.advanceTimersByTimeAsync(15000);
    expect(getRetainedPmPrivateKey(12)).toBeUndefined();
  });
  it("concurrent saves retain the latest snapshot rather than losing the second update", async () => {
    const pm = account(); pm.token = JSON.stringify({ walletAddress, privateKey: pk });
    mocks.send.mockResolvedValue({ ...reply(), expiresAt: -1 });
    await prepareRetainedPmSession("u");
    let release!: () => void;
    let saves = 0;
    mocks.send.mockImplementation(message => {
      if (message.type === "pmWalletSession:save" && ++saves === 1)
        return new Promise(resolve => { release = () => resolve({ ...reply(), expiresAt: -1 }); });
      return Promise.resolve({ ...reply(), expiresAt: -1 });
    });
    const first = saveRetainedPmSession([pm], "u");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const replacement = `0x${"ef".repeat(32)}`;
    pm.token = JSON.stringify({ walletAddress, privateKey: replacement });
    const second = saveRetainedPmSession([pm], "u");
    release();
    await Promise.all([first, second]);
    expect(saves).toBe(2);
    expect(getRetainedPmPrivateKey(12)).toBe(replacement);
  });
  it("supports optional 24-hour retention and falls back to browser-session for invalid preferences", () => {
    setRetainedPmHours(24); expect(retainedPmSessionUi.hours).toBe(24);
    setRetainedPmHours(999); expect(retainedPmSessionUi.hours).toBe(0);
  });
  it.each([
    ["FORBIDDEN", "开发端口变更"],
    ["UNSUPPORTED", "更新并重新加载"],
    ["AUTH_UNAVAILABLE", "/auth 代理"],
  ])("reports actionable recovery failure for %s", async (code, expected) => {
    mocks.send.mockResolvedValue({ ok: false, code });
    expect(await restoreRetainedPmSession([account()], "u")).toBe(false);
    expect(retainedPmSessionUi.error).toContain(expected);
  });
  it("restores PM keys without restoring PredictFun or the shared vault KEK", async () => {
    const pm = account(); const pf = account("PredictFun", 13);
    mocks.send.mockResolvedValue(reply());
    expect(await restoreRetainedPmSession([pm, pf], "u")).toBe(true);
    expect(JSON.parse(pm.token!).privateKey).toBe(pk);
    expect(JSON.parse(pf.token!).privateKey).toBeUndefined();
    expect(getRetainedPmPrivateKey(12, "u")).toBe(pk);
    expect(getRetainedPmPrivateKey(12, "other")).toBeUndefined();
  });
  it("rejects changed/deleted local ciphertext and wrong wallet/account binding", async () => {
    mocks.send.mockResolvedValue({ ...reply(), entries: [{ ...reply().entries[0], binding: "old-cipher" }] });
    expect(await restoreRetainedPmSession([account()], "u")).toBe(false);
    clearRetainedPmMemory();
    mocks.send.mockResolvedValue(reply());
    expect(await restoreRetainedPmSession([account("Polymarket", 99)], "u")).toBe(false);
  });
  it("expires at the deadline even while the backend poll is in flight, clears PM and signer cache", async () => {
    const pm = account(); const pf = account("PredictFun", 13);
    pf.token = JSON.stringify({ privateKey: "pf-key" });
    const clean = vi.fn(); registerRetainedPmCleanup(clean);
    mocks.send.mockResolvedValueOnce(reply()).mockImplementation(() => new Promise(() => {}));
    await restoreRetainedPmSession([pm, pf], "u");
    await vi.advanceTimersByTimeAsync(3600000);
    expect(getRetainedPmPrivateKey(12)).toBeUndefined();
    expect(JSON.parse(pm.token!).privateKey).toBeUndefined();
    expect(JSON.parse(pf.token!).privateKey).toBe("pf-key");
    expect(mocks.clear).toHaveBeenCalled();
    expect(clean).toHaveBeenCalledWith([12], [walletAddress]);
  });
  it("a late restore response after locking cannot put keys back", async () => {
    let resolve!: (value: unknown) => void;
    mocks.send.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ ok: true });
    const pm = account(); const restoring = restoreRetainedPmSession([pm], "u");
    await revokeRetainedPmSession("u");
    resolve(reply());
    expect(await restoring).toBe(false);
    expect(JSON.parse(pm.token!).privateKey).toBeUndefined();
  });
  it("older plugins time out and disabled retention performs no recovery", async () => {
    mocks.send.mockImplementation(() => new Promise(() => {}));
    const restoring = restoreRetainedPmSession([account()], "u");
    await vi.advanceTimersByTimeAsync(6500);
    expect(await restoring).toBe(false);
    retainedPmSessionUi.enabled = false;
    mocks.send.mockClear();
    expect(await restoreRetainedPmSession([account()], "u")).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("save sends PM keys only, captured generation and duration, never password/KEK/PF", async () => {
    const pm = account(); pm.token = JSON.stringify({ walletAddress, privateKey: pk });
    const pf = account("PredictFun", 13); pf.token = JSON.stringify({ privateKey: "pf-secret" });
    mocks.send.mockResolvedValue(reply());
    await prepareRetainedPmSession("u");
    expect(await saveRetainedPmSession([pm, pf], "u")).toBe(true);
    const sent = mocks.send.mock.calls.find(([message]) => message.type === "pmWalletSession:save")![0];
    expect(sent.data.entries).toHaveLength(1);
    expect(sent.data.revision).toBe("revision-1");
    expect(JSON.stringify(sent)).not.toContain("pf-secret");
    expect(sent.data.password).toBeUndefined(); expect(sent.data.kek).toBeUndefined();
  });
  it("auth session change prevents recovery from a slow earlier login", async () => {
    let resolve!: (value: unknown) => void;
    mocks.send.mockImplementation(() => new Promise(r => { resolve = r; }));
    const restoring = restoreRetainedPmSession([account()], "u");
    mocks.version = "login-2";
    resolve(reply());
    expect(await restoring).toBe(false);
  });
  it("a single-account precheck cannot remove other PM objects from lock cleanup", async () => {
    const first = account();
    const second = account("Polymarket", 14);
    mocks.send.mockResolvedValue(reply());
    await restoreRetainedPmSession([first, second], "u");
    second.token = JSON.stringify({ walletAddress, privateKey: pk });
    await restoreRetainedPmSession([first], "u");
    await revokeRetainedPmSession("u");
    expect(JSON.parse(first.token!).privateKey).toBeUndefined();
    expect(JSON.parse(second.token!).privateKey).toBeUndefined();
  });
});
