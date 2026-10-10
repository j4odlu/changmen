import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { computed, effectScope, nextTick, reactive, toRefs, watch } from "vue";

// [changmen 扩展] Read-only source/behavior audit. Never calls a venue, HTTP API, or database.
const baseline = "219535c8";
const normalize = source => source.replace(/\r\n/g, "\n");
const old = file => normalize(execFileSync("git", ["show", `${baseline}:${file}`], { encoding: "utf8" }));
const current = file => normalize(fs.readFileSync(file, "utf8"));
const verification = current("scripts/verification/verify-fok-execution-parity.mjs");
const exactExpression = verification.slice(verification.indexOf("const exactFiles = ") + "const exactFiles = ".length, verification.indexOf("\n];") + 2);
const exactFiles = vm.runInNewContext(exactExpression);
const extraFiles = [
  "client/web/src/stores/account/accountPicker.ts",
  "client/web/src/stores/accountStore.ts",
  "client/web/src/models/platformAccount.ts",
  "client/web/src/stores/messageStore.ts",
  "client/web/src/shared/pmOrderDisplay.ts",
  "client/web/src/shared/pfOrderDisplay.ts",
  "client/web/src/domain/polymarket/tickBufferQuote.ts",
  "client/web/src/stores/betting/a8/runA8ArbRound.ts",
  "client/web/src/stores/betting/manualBet.ts",
  "client/web/src/components/order/OrderList.vue",
  "client/web/src/extensions/arbBet/arbEarlyLockSell.ts",
  "client/web/src/extensions/arbBet/arbFailAutoSell.ts",
  "server/backend/core/esport-api/account_client_routes.ts",
  "server/backend/core/account/order/dto.js",
  "packages/venue-adapter/polymarket/pmMapOutcomeStore.ts",
];
const hash = source => createHash("sha256").update(source).digest("hex");
const files = [...new Set([...exactFiles, ...extraFiles])].map((file) => {
  const before = old(file);
  const after = current(file);
  return { file, identicalExceptLineEndings: before === after, baselineSha256: hash(before), currentSha256: hash(after) };
});
function load(file, requireModule) {
  const js = ts.transpileModule(current(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: requireModule }, { filename: file, timeout: 1000 });
  return exports;
}

const user = reactive({ userId: "owner", isLoggedIn: true, config: { profit: 0 }, extensionPrefs: { pmArbOrderMode: "GTC", pmGtcV1Activation: undefined, pmGtcV1Participant: false } });
const selection = load("client/web/src/stores/betting/execution/selection.ts", name => name === "pinia" ? { getActivePinia: () => ({}) } : { useUserStore: () => user });
const unactivatedSelection = selection.captureArbExecutionSelection().orderMode;
user.extensionPrefs.pmGtcV1Activation = "1:owner";
const activatedSelection = selection.captureArbExecutionSelection().orderMode;
user.extensionPrefs.pmArbOrderMode = "FOK";

const picker = load("client/web/src/stores/account/accountPicker.ts", () => ({ useUserStore: () => user }));
const account = { accountId: 1, provider: "Polymarket", maxOrder: 1, todayOrder: 0, getBalance: () => 100, profit: 0 };
const pickerContext = { accounts: [account], providerPickIndex: new Map() };
const beforeGtcDailyCount = Boolean(picker.pickAccount(pickerContext, "Polymarket", 10));
account.todayOrder = 1;
const afterGtcDailyCount = Boolean(picker.pickAccount(pickerContext, "Polymarket", 10));
const rotation = { accounts: [{ ...account, accountId: 1, maxOrder: 0 }, { ...account, accountId: 2, maxOrder: 0 }], providerPickIndex: new Map() };
const manualSelectionAccount = picker.pickAccount(rotation, "Polymarket", 0)?.accountId;
const nextFokAccount = picker.pickAccount(rotation, "Polymarket", 0)?.accountId;

const commonOrders = reactive({ orders: new Map() });
const projection = reactive({ owner: "", rows: [] });
const recoveryStarts = [];
const lifecycle = load("client/web/src/orderModes/gtc/lifecycle.ts", (name) => {
  if (name === "vue")
    return { computed, watch };
  if (name === "pinia")
    return { storeToRefs: toRefs };
  if (name === "@/stores/userStore")
    return { useUserStore: () => user };
  if (name === "./executionProjection")
    return { gtcOrderProjection: projection };
  if (name === "@/stores/orderStore")
    return { useOrderStore: () => commonOrders };
  if (name === "@/orderModes/gtc/runtime")
    return { startGtcRuntime: owner => recoveryStarts.push(owner), stopGtcRuntime: () => {} };
  throw new Error(`Unexpected lifecycle dependency: ${name}`);
});
const scope = effectScope();
scope.run(() => lifecycle.setupGtcLifecycle());
commonOrders.orders.set(1, [{ OrderID: "historical-gtc", PmGtcExecutionId: "execution" }]);
async function flush() { await nextTick(); for (let index = 0; index < 10; index++) await Promise.resolve(); await nextTick(); }
await flush();
const commonOrderEvidenceStartsRecovery = recoveryStarts.length > 0;
projection.owner = "owner";
projection.rows = [{ OrderID: "historical-gtc", PmGtcExecutionId: "execution" }];
await flush();
const obsoleteProjectionEvidenceStartsRecovery = recoveryStarts.length > 0;
scope.stop();

const result = {
  baseline,
  baselineHasGtcPreference: /pmArbOrderMode|pmGtcV1Activation/.test(old("client/web/src/types/extensionPrefs.ts")),
  sourceComparison: { files, identical: files.filter(file => file.identicalExceptLineEndings).length, changed: files.filter(file => !file.identicalExceptLineEndings).length },
  findings: {
    selection: { configuredMode: "GTC", withoutActivationActualMode: unactivatedSelection, withActivationActualMode: activatedSelection },
    ordinaryAccountDailyLimit: { beforeGtcDailyCountFokAccountAvailable: beforeGtcDailyCount, afterGtcDailyCountFokAccountAvailable: afterGtcDailyCount, note: "Picker formula is unchanged; the common todayOrder input now includes GTC. This is a shared account limit, distinct from per-market FOK history." },
    sharedManualRotation: { accountChosenBeforeModePrompt: manualSelectionAccount, subsequentFokAccount: nextFokAccount, note: "Current manual entry calls the ordinary getAccount before the user selects GTC or FOK." },
    historicalRecovery: { commonOrderEvidenceStartsRecovery, obsoleteProjectionEvidenceStartsRecovery, note: "With participant hint absent, lifecycle still observes the obsolete separate projection, rather than the common order store." },
    snapshotSave: { strictIdentityReadBeforeOriginalWriter: true, identityFailureSkipsOriginalWriter: true, evidence: "server/backend/core/orderModes/router.test.mjs: a failed strict identity read retains the original save failure and writes neither mode" },
  },
  scope: "Source comparison and offline characterization only. No product changes, real orders, API calls, database writes, or deployments.",
};
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync("output/fok-gtc-current-design-audit.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ baseline, sourceFiles: files.length, exactFiles: result.sourceComparison.identical, changedFiles: files.filter(file => !file.identicalExceptLineEndings).map(file => file.file), findings: result.findings }, null, 2));
