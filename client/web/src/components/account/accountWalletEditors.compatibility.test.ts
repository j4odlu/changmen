import { beforeEach, expect, test, vi } from "vitest";
import { createPolymarketAccountEditor } from "./polymarketAccountEditor";
import { createPredictFunAccountEditor } from "./predictFunAccountEditor";
import type { AccountEditContext } from "./accountEditContext";
import { createAccountEditFormStateFromPlatformAccount } from "./accountEditFormState";
import { PlatformAccount } from "@/models/platformAccount";
import { createOriginalAccountModule } from "./__tests__/accountEditOriginal";
import * as parse from "./accountCredentialParse";
import * as pm from "@changmen/venue-browser/adapter/polymarket";
import * as pf from "@changmen/venue-browser/adapter/predictfun";
import * as vault from "@/security/pmVault";
import { ElMessage } from "element-plus";

const m = vi.hoisted(() => ({ unlocked: true, exists: true, cached: "", signer: vi.fn(), deposit: vi.fn(), creds: vi.fn(), unlock: vi.fn(), has: vi.fn(), message: vi.fn(), prepare: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: { success: m.message, error: m.message } }));
vi.mock("@/config/apiBase", () => ({ getApiBase: () => "https://app.test" }));
vi.mock("@/lib/authCredentials", () => ({ createRequestAuthProvider: () => async () => ({}), getRequestAuthHeaders: async () => ({}) }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
  normalizePolymarketPrivateKey: (key: string) => key,
  resolvePolymarketSignerAddress: m.signer, resolvePolymarketDepositWalletFromPrivateKey: m.deposit,
  createOrDerivePolymarketApiCreds: m.creds, fetchPolymarketRelayerStatus: async () => ({ configured: true }), preparePolymarketWallet: m.prepare,
}));
vi.mock("@changmen/venue-browser/adapter/predictfun", () => ({
  parsePredictFunTokenConfig: (token: string) => { try { return JSON.parse(token || "{}"); } catch { return {}; } },
  resolvePredictFunPredictAccount: (cfg: { predictAccount?: string }) => cfg.predictAccount || "",
  resolvePredictFunPrivyPrivateKey: (cfg: { privyPrivateKey?: string }) => cfg.privyPrivateKey || "",
  normalizePredictFunPrivateKey: (key: string) => key,
  isValidPredictFunPrivateKey: (key: string) => /^0x[0-9a-f]{64}$/.test(key),
  isValidPredictFunAddress: (address: string) => /^0x[0-9a-f]{40}$/.test(address),
  resolvePredictFunPrivyAddressFromPrivateKey: () => "0x" + "1".repeat(40),
  buildPredictFunMemoryToken: (value: unknown) => JSON.stringify(value),
  buildPredictFunPersistToken: (predictAccount: string) => JSON.stringify({ predictAccount }),
}));
vi.mock("@/security/pmVault", () => ({
  isPmVaultUnlocked: () => m.unlocked, vaultHasKey: m.has, getCachedPrivateKey: () => m.cached,
  hasVault: async () => true, ensurePmVaultUnlocked: m.unlock, ensurePmVaultSetup: async () => true,
  putPrivateKeyInVault: vi.fn(), extractPrivateKeyFromToken: (token: string) => { try { return JSON.parse(token || "{}").privateKey || ""; } catch { return ""; } },
}));
const key = "0x" + "1".repeat(64), wallet = "0x" + "1".repeat(40), funder = "0x" + "2".repeat(40);
beforeEach(() => {
  vi.clearAllMocks(); m.unlocked = true; m.exists = true; m.cached = "";
  m.has.mockImplementation(async () => m.exists);
  m.unlock.mockImplementation(async () => { m.unlocked = true; return true; });
  m.signer.mockResolvedValue(wallet); m.deposit.mockResolvedValue({ walletAddress: wallet, funder });
  m.creds.mockResolvedValue({ signerAddress: wallet, apiCreds: { apiKey: "api", secret: "synthetic-secret", passphrase: "synthetic-passphrase" } });
  m.prepare.mockResolvedValue({ ok: true });
});
const deps = { ...parse, ...pm, ...pf, ...vault, ElMessage, getApiBase: () => "https://app.test",
  createRequestAuthProvider: () => async () => ({}), getRequestAuthHeaders: async () => ({}) };
type Provider = "Polymarket" | "PredictFun";
type Source = "typed" | "form" | "account" | "vault" | "missing";
function context(provider: Provider, source: Source) {
  const account = new PlatformAccount({ accountId: 9, playerName: "name", provider });
  const token = JSON.stringify({ walletAddress: wallet, funder, predictAccount: funder,
    ...(provider === "Polymarket" ? { privateKey: key } : { privyPrivateKey: key }) });
  account.token = source === "account" ? token : "{}";
  let form = createAccountEditFormStateFromPlatformAccount(account);
  form.token = source === "form" ? token : JSON.stringify({ walletAddress: wallet, funder, predictAccount: funder });
  const ctx: AccountEditContext = { get form() { return form; }, props: { open: true, account }, userStore: { userId: 1 } };
  return { ctx, replace: () => { form = { ...form, gateway: "https://changed.test" }; }, token };
}
async function exercise(old: boolean, provider: Provider, source: Source, unlocked: boolean, failure: boolean) {
  m.unlocked = unlocked; m.cached = source === "vault" ? key : ""; m.exists = source !== "missing";
  if (failure) m.signer.mockRejectedValue(new Error("signer unavailable"));
  else m.signer.mockResolvedValue(wallet);
  const { ctx } = context(provider, source);
  let token = "", error = "", input = "", local = "";
  if (provider === "Polymarket") {
    const api = old ? createOriginalAccountModule<ReturnType<typeof createPolymarketAccountEditor>>("polymarketAccountEditor", ctx, deps) : createPolymarketAccountEditor(ctx);
    api.syncPolymarketFieldsFromToken(ctx.form.token);
    if (source === "typed") api.polyPrivateKey.value = key;
    try { token = await api.ensurePolymarketToken(); } catch (e) { error = (e as Error).message; }
    input = api.polyPrivateKey.value; local = api.polyLocalKeyStatus.value;
  } else {
    const api = old ? createOriginalAccountModule<ReturnType<typeof createPredictFunAccountEditor>>("predictFunAccountEditor", ctx, deps) : createPredictFunAccountEditor(ctx);
    api.syncPredictFunFieldsFromToken(ctx.form.token);
    if (source === "typed") api.pfPrivyPrivateKey.value = key;
    try { token = await api.ensurePredictFunToken(); } catch (e) { error = (e as Error).message; }
    input = api.pfPrivyPrivateKey.value; local = api.pfLocalKeyStatus.value;
  }
  await Promise.resolve();
  return { token, error, input, local, form: JSON.parse(JSON.stringify(ctx.form)) };
}
const cases: [Provider, Source, boolean, boolean][] = [];
for (const provider of ["Polymarket", "PredictFun"] as const)
  for (const source of ["typed", "form", "account", "vault", "missing"] as const)
    for (const unlocked of [true, false]) for (const failure of [true, false]) cases.push([provider, source, unlocked, failure]);
test.each(cases)("preserves key source, unlocking and token rules: %s/%s unlocked=%s failure=%s", async (provider, source, unlocked, failure) => {
  expect(await exercise(false, provider, source, unlocked, failure)).toEqual(await exercise(true, provider, source, unlocked, failure));
});

test.each([true, false])("cancels a pending derivation without mutating the new account, original=%s", async old => {
  const { ctx } = context("Polymarket", "typed");
  const api = old ? createOriginalAccountModule<ReturnType<typeof createPolymarketAccountEditor>>("polymarketAccountEditor", ctx, deps) : createPolymarketAccountEditor(ctx);
  api.polyPrivateKey.value = key;
  let finish!: (value: string) => void;
  m.signer.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const promise = api.ensurePolymarketToken();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const rejected = expect(promise).rejects.toThrow("操作已取消");
  api.cancelPending(); finish(wallet); await rejected;
  expect(api.polyWalletAddress.value).toBe(""); expect(api.polyGenerating.value).toBe(false);
});

test("editors use the current form after a v-model replacement and keep instance state isolated", async () => {
  const { ctx, replace } = context("Polymarket", "form");
  const first = createPolymarketAccountEditor(ctx), second = createPolymarketAccountEditor(ctx);
  first.polyPrivateKey.value = key; replace();
  await first.ensurePolymarketToken();
  expect(JSON.parse(ctx.form.token).privateKey).toBe(key);
  expect(first.polymarketCredentialFingerprint()).toContain("https://changed.test");
  expect(second.polyPrivateKey.value).toBe(""); expect(second.polyWalletAddress.value).toBe("");
});


test("PM save reports connection stages, reuses credentials and never prepares the wallet automatically", async () => {
  const { ctx } = context("Polymarket", "account");
  const api = createPolymarketAccountEditor(ctx);
  api.syncPolymarketFieldsFromToken(ctx.props.account!.token!);
  const stages: string[] = [];
  await api.ensurePolymarketToken(stage => stages.push(stage));
  expect(stages).toEqual(["识别钱包", "获取 API 凭证"]);
  expect(m.creds).toHaveBeenCalledOnce();
  m.creds.mockClear();
  ctx.form.pause = !ctx.form.pause;
  await api.ensurePolymarketToken();
  expect(m.creds).not.toHaveBeenCalled();
  expect(m.prepare).not.toHaveBeenCalled();
});
