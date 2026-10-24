import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ref } from "vue";
import { resolveAccountMultiply } from "@changmen/shared/account_multiply";
import { normalizeAccountRateConfig, PlatformAccount } from "@/models/platformAccount";
import { createAccountEditFormStateFromPlatformAccount } from "./accountEditFormState";
import { createAccountEditSave } from "./accountEditSave";
import type { AccountEditContext } from "./accountEditContext";
import { createOriginalAccountModule } from "./__tests__/accountEditOriginal";
import { isObSportBetToken } from "@/runtime/obSportBetAccount";

const m = vi.hoisted(() => ({ adapter: vi.fn(), admin: vi.fn(), message: vi.fn(), loading: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: { success: (s: unknown) => m.message("success", s), error: (s: unknown) => m.message("error", s) }, ElLoading: { service: m.loading } }));
vi.mock("@/api/admin", () => ({ updateAdminAccountMultiply: m.admin }));
vi.mock("@/runtime/venueAdapters", () => ({ getAdapter: m.adapter }));
vi.mock("@/security/pmVault", () => ({ extractPrivateKeyFromToken: (s: string) => {
  try { return JSON.parse(s).privateKey || ""; } catch { return ""; }
} }));
vi.mock("@changmen/venue-browser/adapter/predictfun", () => ({
  buildPredictFunMemoryToken: (o: unknown) => JSON.stringify(o),
  buildPredictFunPersistToken: (predictAccount: string) => JSON.stringify({ predictAccount }),
}));

type Options = { provider: PlatformAccount["provider"]; edit: boolean; sport?: boolean; fail?: string; readonly?: boolean; blankName?: boolean; duplicate?: boolean; mismatch?: boolean; invalidRate?: boolean; blankPlatform?: boolean; admin?: boolean; progress?: boolean; retry?: boolean };
const cases: Options[] = [];
for (const provider of ["Stake", "OB", "RAY", "PB", "Polymarket", "PredictFun", "SABA"] as const)
  for (const edit of [false, true])
    for (const fail of [undefined, "balance", "vault-ready", "vault-write", "create-tag", "save-accounts", "create-account", "refresh-orders"])
      cases.push({ provider, edit, fail });
for (const edit of [false, true])
  for (const fail of [undefined, "sport-probe", "save-sport", "save-accounts"])
    cases.push({ provider: "OB", edit, sport: true, fail });
for (const provider of ["Stake", "Polymarket", "PredictFun", "OB"] as const)
  for (const flags of [{ readonly: true }, { blankName: true }, { duplicate: true }, { mismatch: true }, { invalidRate: true }, { blankPlatform: true }])
    cases.push({ provider, edit: flags.mismatch ?? false, ...flags });
const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1790000000000); vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function exercise(old: boolean, opts: Options) {
  const trace: unknown[] = [];
  const step = (name: string, ...args: unknown[]) => { trace.push([name, ...args.map(snapshot)]); if (opts.fail === name) throw new Error(name + " failed"); };
  const source = new PlatformAccount({ accountId: opts.edit ? 9 : 0, playerName: "Original", provider: opts.provider });
  source.token = "1234567890";
  if (opts.edit) source.venueMemberId = opts.mismatch ? "other-member" : "member-one";
  const form = createAccountEditFormStateFromPlatformAccount(source);
  Object.assign(form, { platformName: opts.blankPlatform ? " " : " Platform ", playerName: opts.blankName ? "" : " Player ",
    gateway: "https://venue.test", token: source.token, credit: 123, description: " notes ", rateConfig: [{ minOdds: 1, maxOdds: 3, rate: opts.invalidRate ? "invalid" : 0.7 }] });
  const props = { open: true, account: opts.edit ? source : undefined, readonly: opts.readonly,
    adminTargetUserId: opts.admin ? "owner" : undefined, allowMultiplyEdit: opts.admin };
  const userStore = { userId: "owner" };
  const patchAccount = source.applyPatch.bind(source);
  source.applyPatch = patch => { step("apply-patch", patch); patchAccount(patch); };
  const accountStore = {
    accounts: opts.duplicate ? [{ accountId: 88, provider: opts.provider, venueMemberId: "member-one", platformName: "Existing", playerName: "Duplicate" }] : [source],
    saveAccounts: async () => { step("save-accounts"); },
    saveSportAccount: async (...args: unknown[]) => { step("save-sport", ...args); },
    createTagPlatform: async (...args: unknown[]) => { step("create-tag", ...args); return { playerId: 99, playerName: "Created", platformId: 33, platformName: "Platform" }; },
    createAccount: async (record: unknown) => { step("create-account", record); },
    refreshBalance: async () => { step("refresh-balance"); },
    updateVenueOrders: async () => { step("refresh-orders"); },
  };
  const saving = ref(false), obTokenTab = ref(opts.sport ? "sport" : "esport");
  const sportObForm = { token: opts.sport ? "abcdef1234567890abcdef1234567890" : "", gateway: "https://sport.test", referer: "https://sport.test/", venueMemberId: "1234567890123456789", venueAccountName: "Sport" };
  const polymarket = {
    polyPrivateKey: ref(""), polyLocalKeyStatus: ref("ready"),
    resolvePolymarketPrivateKeyForSave: async () => { step("pm-key"); return "synthetic-pm-key"; },
    ensurePrivateKeyInVault: async (...args: unknown[]) => { step("vault-write", ...args); },
    ensurePmVaultReadyBeforeCreate: async () => { step("vault-ready"); },
    buildPolyToken: (privateKey: string) => JSON.stringify({ privateKey, walletAddress: "wallet", funder: "funder" }),
    ensurePolymarketToken: async (onProgress?: (stage: string) => void) => { step("pm-token"); onProgress?.("识别钱包"); onProgress?.("获取 API 凭证"); form.token = JSON.stringify({ privateKey: "synthetic-pm-key" }); return form.token; },
  };
  const predictFun = {
    pfPrivyPrivateKey: ref(""), pfPredictAccount: ref("predict-wallet"), pfLocalKeyStatus: ref("ready"),
    resolvePredictFunPrivyKeyForSave: async () => { step("pf-key"); return "synthetic-pf-key"; },
    ensurePredictFunToken: async () => { step("pf-token"); form.token = JSON.stringify({ privyPrivateKey: "synthetic-pf-key", predictAccount: "predict-wallet" }); return JSON.stringify({ predictAccount: "predict-wallet" }); },
    refreshPfPrivyAddressDisplay: () => { step("pf-display"); },
  };
  const ctx = { get form() { return form; }, props, userStore, accountStore, saving, obTokenTab, sportObForm, polymarket, predictFun,
    ...(opts.progress ? { onPolymarketSaveProgress: (stage: string, error?: string) => { trace.push(["progress", stage, error || ""]); } } : {}),
    emit: (...args: unknown[]) => { step("emit", ...args); },
    sportObFromForm: () => opts.sport ? { ...sportObForm } : undefined,
    probeObSportCredentialForSave: async () => { step("sport-probe"); return { amount: 17, venueMemberId: "1234567890123456789", venueAccountName: "Sport" }; },
  };
  m.message.mockImplementation((...args) => { trace.push(["message", ...args]); });
  m.loading.mockImplementation((args) => { trace.push(["loading", args.text]); return { close: () => trace.push(["loading-close"]) }; });
  m.adapter.mockReturnValue({ provider: { getBalance: async (probe: PlatformAccount) => {
    step("balance", { provider: probe.provider, token: probe.token, accountId: probe.accountId });
    return { balance: 50, currency: "CNY", venueMemberId: "member-one", venueAccountName: "Venue" };
  } } });
  m.admin.mockImplementation(async args => { step("admin", args); return { multiply: 0.8 }; });
  const messages = await import("element-plus"), vault = await import("@/security/pmVault"), pf = await import("@changmen/venue-browser/adapter/predictfun");
  const dependencies = { ...ctx, ...polymarket, ...predictFun, ...messages, ...vault, ...pf,
    normalizeAccountRateConfig, PlatformAccount, resolveAccountMultiply, isObSportBetToken,
    getAdapter: m.adapter, updateAdminAccountMultiply: m.admin };
  const api = old ? createOriginalAccountModule<ReturnType<typeof createAccountEditSave>>("accountEditSave", ctx as unknown as AccountEditContext, dependencies)
    : createAccountEditSave(ctx as unknown as Parameters<typeof createAccountEditSave>[0]);
  if (opts.admin) await api.saveAdminAccountFields(); else await api.save();
  if (opts.retry) { opts.fail = undefined; await api.save(); }
  for (let i = 0; i < 12; i++) await Promise.resolve();
  return snapshot({ trace, form, account: { accountId: source.accountId, provider: source.provider, token: source.token, sportOb: source.sportOb, sportBalance: source.sportBalance },
    saving: saving.value, pmKey: polymarket.polyPrivateKey.value, pfKey: predictFun.pfPrivyPrivateKey.value });
}

test.each(cases)("keeps original save behavior: $provider edit=$edit sport=$sport failure=$fail", async (opts) => {
  const before = await exercise(true, opts), after = await exercise(false, opts);
  expect(after).toEqual(before);
  expect(after.saving).toBe(false);
});

test.each([false, true])("retains admin multiply-only behavior and notifications, edit allowed=%s", async (allowed) => {
  const opts = { provider: "Polymarket", edit: true, admin: allowed } as const;
  expect(await exercise(false, opts)).toEqual(await exercise(true, opts));
});

test("keeps vault/create/close order and edit identity without new account creation", async () => {
  const created = await exercise(false, { provider: "Polymarket", edit: false });
  const names = created.trace.map((row: unknown[]) => row[0]);
  expect(names.indexOf("vault-ready")).toBeLessThan(names.indexOf("create-tag"));
  expect(names.indexOf("create-tag")).toBeLessThan(names.indexOf("vault-write"));
  expect(names.indexOf("vault-write")).toBeLessThan(names.indexOf("emit"));
  expect(names.indexOf("emit")).toBeLessThan(names.indexOf("create-account"));
  const edited = await exercise(false, { provider: "PredictFun", edit: true });
  expect(edited.account.accountId).toBe(9);
  expect(edited.trace.some((row: unknown[]) => row[0] === "create-tag")).toBe(false);
  const probe = edited.trace.find((row: unknown[]) => row[0] === "balance");
  expect(probe[1].token).toContain("synthetic-pf-key");
});

test("PM save reports connection stages and preserves original save behavior", async () => {
  const result = await exercise(false, { provider: "Polymarket", edit: true, progress: true });
  expect(result.trace.filter((row: unknown[]) => row[0] === "progress").map((row: unknown[]) => row[1]))
    .toEqual(["识别钱包", "识别钱包", "获取 API 凭证", "验证连接", "保存账号"]);
  expect(result.trace.some((row: unknown[]) => row[0] === "loading")).toBe(true);
  expect(result.trace).toContainEqual(["emit", "close"]);
});

test.each([
  { fail: "pm-token", stage: "识别钱包" },
  { fail: "balance", stage: "验证连接" },
  { fail: "save-accounts", stage: "保存账号" },
])("PM $fail failure reports its stage and permits retry", async ({ fail, stage }) => {
  const result = await exercise(false, { provider: "Polymarket", edit: true, progress: true, fail, retry: true });
  expect(result.trace).toContainEqual(["progress", stage, `${fail} failed`]);
  expect(result.trace).toContainEqual(["emit", "close"]);
  expect(result.saving).toBe(false);
});
