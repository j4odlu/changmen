import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { compileScript, parse, registerTS } from "@vue/compiler-sfc";
import * as vue from "vue";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as model from "@/models/platformAccount";
import * as formState from "./accountEditFormState";
import * as credentials from "./accountCredentialParse";
import * as multiply from "@changmen/shared/account_multiply";
import * as sportInput from "@/runtime/obSportSessionLocal";
import * as sportAccount from "@/runtime/obSportBetAccount";
import * as sportTrial from "@/runtime/obSportTrial";
import * as pmEditor from "./polymarketAccountEditor";
import * as pfEditor from "./predictFunAccountEditor";
import * as obEditor from "./obSportAccountEditor";
import * as pasteEditor from "./accountCredentialPaste";
import * as saveEditor from "./accountEditSave";
import { originalAccountDialog } from "./__tests__/accountEditOriginal";
import type { AccountEditFormState } from "./accountEditFormState";

const m = vi.hoisted(() => ({ trace: [] as unknown[], member: "member-one", signer: vi.fn(), derive: vi.fn(), creds: vi.fn(),
  message: vi.fn(), load: vi.fn(), adapter: vi.fn(), vaultWrite: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessage: Object.assign((value: unknown) => m.message(value), { success: m.message, error: m.message }),
  ElLoading: { service: () => ({ close: () => {} }) } }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({ normalizePolymarketPrivateKey: (key: string) => key,
  resolvePolymarketSignerAddress: m.signer, resolvePolymarketDepositWalletFromPrivateKey: m.derive,
  createOrDerivePolymarketApiCreds: m.creds, fetchPolymarketRelayerStatus: async () => ({ configured: true }), preparePolymarketWallet: async () => ({ ok: true }) }));
vi.mock("@changmen/venue-browser/adapter/predictfun", () => ({
  parsePredictFunTokenConfig: (token: string) => { try { return JSON.parse(token || "{}"); } catch { return {}; } },
  resolvePredictFunPredictAccount: (cfg: { predictAccount?: string }) => cfg.predictAccount || "",
  resolvePredictFunPrivyPrivateKey: (cfg: { privyPrivateKey?: string }) => cfg.privyPrivateKey || "",
  normalizePredictFunPrivateKey: (key: string) => key, isValidPredictFunPrivateKey: (key: string) => Boolean(key), isValidPredictFunAddress: (address: string) => /^0x[0-9a-f]{40}$/.test(address),
  resolvePredictFunPrivyAddressFromPrivateKey: () => "0x" + "1".repeat(40),
  buildPredictFunMemoryToken: (value: unknown) => JSON.stringify(value), buildPredictFunPersistToken: (predictAccount: string) => JSON.stringify({ predictAccount }),
}));
vi.mock("@/security/pmVault", () => ({ isPmVaultUnlocked: () => true, vaultHasKey: async () => true, getCachedPrivateKey: () => "synthetic-key",
  hasVault: async () => true, ensurePmVaultUnlocked: async () => true, ensurePmVaultSetup: async () => true,
  putPrivateKeyInVault: m.vaultWrite, extractPrivateKeyFromToken: (token: string) => { try { return JSON.parse(token || "{}").privateKey || ""; } catch { return ""; } } }));
vi.mock("@/config/apiBase", () => ({ getApiBase: () => "https://app.test" }));
vi.mock("@/lib/authCredentials", () => ({ createRequestAuthProvider: () => async () => ({}), getRequestAuthHeaders: async () => ({}) }));
vi.mock("@/api/admin", () => ({ updateAdminAccountMultiply: vi.fn() }));
vi.mock("@/runtime/venueAdapters", () => ({ getAdapter: m.adapter }));
vi.mock("@/components/account/accountGatewayProbe", () => ({ createGatewayProbeAccount: vi.fn(), pickFastestGateway: vi.fn() }));
vi.mock("@changmen/venue-browser/adapter/pb", () => ({ parsePbVenueIdentity: () => undefined }));

registerTS(() => ts);
const filename = resolve(process.cwd(), "src/components/account/AccountEditDialog.vue");
function compile(source: string) {
  const script = compileScript(parse(source, { filename }).descriptor, { id: "account-wiring-audit", fs: {
    fileExists: existsSync, readFile: file => readFileSync(file, "utf8"),
  } });
  return ts.transpileModule(script.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
const before = compile(originalAccountDialog), after = compile(readFileSync(filename, "utf8"));
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
interface DialogState {
  form: AccountEditFormState;
  polyPrivateKey: vue.Ref<string>;
  pfPrivyPrivateKey: vue.Ref<string>;
  pfPredictAccount: vue.Ref<string>;
  polyWalletAddress: vue.Ref<string>;
  pfPrivyAddress: vue.Ref<string>;
  obTokenTab: vue.Ref<string>;
  pasteRaw: vue.Ref<string>;
  saving: vue.Ref<boolean>;
  gameShow: vue.Ref<boolean>;
  save: () => Promise<void>;
  applyPaste: () => Promise<void>;
  resetForm: (account?: model.PlatformAccount) => void;
}
const scopes: vue.EffectScope[] = [];
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(1790000000000);
  m.signer.mockResolvedValue("0x" + "1".repeat(40)); m.derive.mockResolvedValue({ walletAddress: "0x" + "1".repeat(40), funder: "0x" + "2".repeat(40) });
  m.creds.mockResolvedValue({ signerAddress: "0x" + "1".repeat(40), apiCreds: { apiKey: "api", secret: "synthetic", passphrase: "synthetic" } });
  m.adapter.mockReturnValue({ provider: { getBalance: async () => ({ balance: 30, currency: "CNY", venueMemberId: "member-one", venueAccountName: "Venue" }) } });
});
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers(); });

async function setup(old: boolean, provider: model.PlatformAccount["provider"], editing: boolean, sports = false) {
  const trace: unknown[] = [];
  const account = new model.PlatformAccount({ accountId: editing ? 9 : 0, playerName: "Original", provider, platformName: "Platform" });
  account.token = provider === "Polymarket" ? JSON.stringify({ privateKey: "synthetic-key", walletAddress: "0x" + "1".repeat(40), funder: "0x" + "2".repeat(40) })
    : provider === "PredictFun" ? JSON.stringify({ privyPrivateKey: "synthetic-key", predictAccount: "0x" + "2".repeat(40) }) : "1234567890";
  account.venueMemberId = "member-one";
  const props = vue.reactive({ open: false, account: editing ? account : undefined, readonly: false });
  const user = vue.reactive({ userId: 1, proxyList: [], loadExtras: async () => { trace.push("extras"); } });
  const store = vue.reactive({ accounts: editing ? [account] : [], tagPlatforms: [],
    loadTagPlatforms: async () => { trace.push("platforms"); },
    saveAccounts: async () => { trace.push("save-accounts"); }, saveSportAccount: async () => {},
    refreshBalance: async () => { trace.push("refresh-balance"); }, updateVenueOrders: async () => { trace.push("refresh-orders"); },
    createTagPlatform: async (...args: unknown[]) => { trace.push(["create-tag", ...json(args)]); return { playerId: 99, playerName: "Created", platformId: 5, platformName: "Platform" }; },
    createAccount: async (record: unknown) => { trace.push(["create-account", json(record)]); },
  });
  m.message.mockImplementation(value => trace.push(["message", value]));
  m.vaultWrite.mockImplementation(async (...args) => { trace.push(["vault", ...args]); });
  const modules: Record<string, unknown> = {
    vue, pinia: { storeToRefs: (source: Record<string, unknown>) => ({ proxyList: vue.toRef(source, "proxyList"), tagPlatforms: vue.toRef(source, "tagPlatforms") }) },
    "vue-router": { useRoute: () => ({ path: sports ? "/sports" : "/" }) },
    "@changmen/shared/account_multiply": multiply, "@/models/platformAccount": model,
    "@/components/account/accountEditFormState": formState, "@/components/account/accountCredentialParse": credentials,
    "@/stores/accountStore": { useAccountStore: () => store }, "@/stores/userStore": { useUserStore: () => user },
    "@/runtime/obSportSessionLocal": sportInput, "@/runtime/obSportBetAccount": sportAccount, "@/runtime/obSportTrial": sportTrial,
    "./polymarketAccountEditor": pmEditor, "./predictFunAccountEditor": pfEditor, "./obSportAccountEditor": obEditor,
    "./accountCredentialPaste": pasteEditor, "./accountEditSave": saveEditor,
    "./AccountEditPanel.vue": { default: {} }, "@/components/account/AccountEditPanel.vue": { default: {} },
  };
  for (const spec of ["element-plus", "@changmen/venue-browser/adapter/polymarket", "@changmen/venue-browser/adapter/predictfun", "@/security/pmVault",
    "@/config/apiBase", "@/lib/authCredentials", "@/api/admin", "@/runtime/venueAdapters", "@/components/account/accountGatewayProbe", "@changmen/venue-browser/adapter/pb"])
    modules[spec] = await vi.importMock(spec);
  const exports: Record<string, unknown> = {};
  runInNewContext(old ? before : after, { exports, require: (spec: string) => {
    if (!(spec in modules)) throw new Error("Unexpected component dependency: " + spec);
    return modules[spec];
  }, console, Date, JSON, Error, Promise, structuredClone, navigator: globalThis.navigator, window: globalThis.window });
  const component = exports.default as { setup: (props: unknown, context: unknown) => DialogState };
  const scope = vue.effectScope(); scopes.push(scope);
  const state = scope.run(() => component.setup(props, { expose: () => {}, emit: (event: string) => {
    trace.push(["emit", event]); if (event === "close") { props.open = false; props.account = undefined; }
  } }))!;
  props.open = true; await vue.nextTick();
  return { state, trace, props, account };
}

const cases: [model.PlatformAccount["provider"], boolean][] = [];
for (const provider of ["Stake", "OB", "Polymarket", "PredictFun"] as const) for (const edit of [false, true]) cases.push([provider, edit]);
test.each(cases)("compiled dialog preserves live state, close/save and watcher wiring: %s edit=%s", async (provider, edit) => {
  async function exercise(old: boolean) {
    const { state, trace, account } = await setup(old, provider, edit);
    expect(state.polyPrivateKey.value).toBe(""); expect(state.pfPrivyPrivateKey.value).toBe("");
    // Exercise the actual setter generated for the panel's v-model, then save via the actual UI handler.
    state.form = vue.reactive({ ...state.form, provider, platformName: "Replaced form", playerName: "Replaced player" });
    await vue.nextTick();
    if (!edit && provider === "Polymarket") state.polyPrivateKey.value = "synthetic-key";
    if (!edit && provider === "PredictFun") { state.pfPrivyPrivateKey.value = "synthetic-key"; state.pfPredictAccount.value = "0x" + "2".repeat(40); }
    await vue.nextTick();
    await state.save(); for (let i = 0; i < 12; i++) await Promise.resolve(); await vue.nextTick();
    expect(trace).toContainEqual(["emit", "close"]);
    expect(trace.some(row => Array.isArray(row) && row[0] === "message" && row[1] !== "账号设置已保存")).toBe(false);
    return json({ trace, form: state.form, token: account.token, tab: state.obTokenTab.value, saving: state.saving.value });
  }
  expect(await exercise(false)).toEqual(await exercise(true));
});

test.each([false, true])("compiled OB workspace route and paste wiring are preserved, sports=%s", async sports => {
  async function exercise(old: boolean) {
    const { state, trace } = await setup(old, "OB", true, sports);
    state.pasteRaw.value = JSON.stringify({ provider: "OB", token: "9876543210", gateway: "https://venue.test", referer: "https://venue.test/" });
    await state.applyPaste(); await vue.nextTick();
    return json({ form: state.form, tab: state.obTokenTab.value, trace });
  }
  expect(await exercise(false)).toEqual(await exercise(true));
});
