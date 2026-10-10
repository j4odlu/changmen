import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// [changmen 扩展] Execute the actual entry/selector/router offline. A core-source PASS
// does not waive changes to shared selection rules, added I/O, or failure propagation.
const snapshot = JSON.parse(fs.readFileSync("output/vps-fok-baseline.json", "utf8"));
const modules = {
  manual: "client/web/src/stores/betting/manualBet.ts",
  picker: "client/web/src/stores/account/accountPicker.ts",
  fok: "client/web/src/orderModes/fok/manual.ts",
  router: "server/backend/core/orderModes/router.js",
};
function load(file, require, deployed = false) {
  const source = deployed ? snapshot.sources[file] : fs.readFileSync(file, "utf8");
  assert.equal(typeof source, "string", `Missing actual deployed source: ${file}`);
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require, console, Error }, { filename: file });
  return exports;
}
function deployedFunction(file, name, dependencies, current = false) {
  const source = ts.createSourceFile(file, current ? fs.readFileSync(file, "utf8") : snapshot.sources[file], ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert(found, `Missing deployed function: ${file}:${name}`);
  const text = ts.createPrinter().printNode(ts.EmitHint.Unspecified, found, source).replace(/^export\s+/, "");
  return vm.runInNewContext(`(${text})`, { ...dependencies, console: { error: () => {} } }, { filename: file });
}
async function manualSequence(deployed, cancelFirst) {
  const accounts = [101, 102].map(accountId => ({ accountId, provider: "Polymarket", profit: 0, getBalance: () => 1000 }));
  const providerPickIndex = new Map();
  const trace = [];
  let cancel = cancelFirst;
  let picker;
  let fok;
  const store = {
    accounts,
    providerPickIndex,
    getAccount: (...args) => {
      const account = picker.pickAccount(store, ...args);
      trace.push({ kind: "pick", accountId: account?.accountId });
      return account;
    },
    checkBetting: async (_account, option) => { option.data = {}; return option; },
    betting: async (account) => {
      trace.push({ kind: "fok-post", accountId: account.accountId });
      return { success: true, orderId: "fok-id", tip: { pmOptimisticSaved: true } };
    },
    updateVenueOrders: async () => [],
    refreshBalance: async () => {},
  };
  const dependencies = {
    BetOption: class { constructor(_m, _b, item, target, betMoney) { Object.assign(this, { type: item.type, target, betMoney, itemId: "token", betId: "condition" }); } },
    h: (_component, props) => props,
    ref: value => ({ value }),
    useAccountStore: () => store,
    useUserStore: () => ({ config: { betMoney: 10, profit: 1 } }),
    useMatchStore: () => ({}),
    isMapMuteActive: () => false,
    isPrematchFullMarketAllowed: () => true,
    capturePmPriceQuote: () => {},
    accountPassesMainBetFilter: () => true,
    readValueBetMoney: () => 0,
    buildManualBetContextLines: () => ["context"],
    manualBetToastSeconds: () => 5,
    isPendingConfirmVenueProvider: () => true,
    markSuccessfulBet: () => {},
    refreshOrderListAfterBind: async () => {},
    wait: async () => {},
    ElMessageBox: {
      prompt: async (message) => {
        if (cancel) {
          cancel = false;
          const updateMode = message?.["onUpdate:modelValue"];
          if (typeof updateMode === "function")
            updateMode("GTC");
          trace.push({ kind: "cancel-manual" });
          throw new Error("cancel");
        }
        return { value: "25" };
      },
      alert: async () => {},
    },
    captureManualExecutionSelection: mode => ({ source: "manual", orderMode: mode }),
    executeManualOrder: (...args) => fok.executeManualFok(args[0], args[1], args[3]),
  };
  picker = load(modules.picker, () => dependencies, deployed);
  fok = deployed ? null : load(modules.fok, () => dependencies);
  const entry = load(modules.manual, () => dependencies, deployed);
  const run = () => entry.runManualBet({ id: 1, title: "match", liveRound: 0 }, { id: 2, round: 1 }, { type: "Polymarket", getOdds: () => 2 }, "Home", { setMessage: () => {} });
  if (cancelFirst)
    await run();
  await run();
  return { trace, nextIndex: providerPickIndex.get("Polymarket"), postedAccount: trace.find(row => row.kind === "fok-post")?.accountId };
}
async function transportFault(kind) {
  const calls = [];
  const page = { ok: true, info: { list: [{ OrderID: "fok", PlayerID: 1, Type: "Polymarket" }], total: 1 } };
  const saved = { ok: true, info: true };
  let strictReads = 0;
  const old = {
    handleGetOrderList: async () => { calls.push("original-read"); return page; },
    handleSaveOrder: async () => { calls.push("original-save"); return saved; },
  };
  const db = {
    fetchOrderExecutionIdentities: async () => {
      calls.push("gtc-identity-read");
      if (kind === "hang")
        return new Promise(() => {});
      if (kind === "failure")
        throw new Error("GTC identity unavailable");
      return [];
    },
    fetchOrdersByPlayerOrderIdsStrict: async () => {
      calls.push("strict-order-read");
      strictReads++;
      if (strictReads === 2)
        throw new Error("second strict read unavailable");
      return [];
    },
    upsertOrders: async () => { calls.push("ordinary-upsert"); return true; },
  };
  if (kind === "failure") {
    // Use the actual deployed writer and handler, not a success-only save mock.
    // The first ordinary strict read succeeds; the second fails identically in
    // both runs. A regression that adds an extra read changes the same request's result.
    const dependencies = {
      sb: db,
      parseVenueCreateAt: value => Number(value) || 0,
      findOrderRowById: () => undefined,
      resolveSaveOrderLink: () => 1,
      parseNum: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
      mergeOrderLogicalSave: (_previous, _raw, incoming) => ({ raw: incoming, money: 0, bet_money: incoming.betMoney || 0 }),
      mapStatus: value => value || "None",
      ...load("server/backend/core/orderModes/orderMetadata.js", () => ({})),
      ...load("server/backend/core/orderModes/saveRows.js", () => db),
    };
    const saveOrder = deployedFunction("server/backend/core/account/order_store.js", "saveOrder", dependencies);
    const currentSave = deployedFunction("server/backend/core/account/order_store.js", "saveOrder", dependencies, true);
    const handle = deployedFunction("server/backend/core/account/account_service.js", "handleSaveOrder", {
      orderStore: { saveOrder },
      assertPlayerOwnedByUser: async () => ({ ok: true, player: { provider: "Polymarket" } }),
      isPredictFunClientSaveOrderRequest: () => false,
    });
    const currentHandle = deployedFunction("server/backend/core/account/account_service.js", "handleSaveOrder", {
      orderStore: { saveOrder: currentSave }, assertPlayerOwnedByUser: async () => ({ ok: true, player: { provider: "Polymarket" } }),
      isPredictFunClientSaveOrderRequest: () => false,
    }, true);
    old.handleSaveOrder = async (...args) => { calls.push("original-save"); return handle(...args); };
    old.currentSaveOrder = async (...args) => { calls.push("original-save"); return currentHandle(...args); };
  }
  const router = load(modules.router, name => name === "@changmen/db" ? db : name.includes("account_service") ? { ...old, handleSaveOrder: old.currentSaveOrder ?? old.handleSaveOrder } : {});
  const body = { playerId: 1, type: "Polymarket", orders: JSON.stringify([{ orderId: "fok" }]) };
  if (kind === "failure") {
    const current = await router.saveOrders(body, "owner");
    const currentCalls = [...calls];
    strictReads = 0; calls.length = 0;
    const deployed = await old.handleSaveOrder(body, "owner");
    return { currentCalls, deployedCalls: calls, current, deployed, equal: JSON.stringify(current) === JSON.stringify(deployed) };
  }
  let settled = false;
  const result = router.getOrders({ date: "2026-10-10" }, "owner").then((value) => { settled = true; return value; });
  // Flush asynchronous continuations; no wall-clock sleeps or live database calls.
  for (let i = 0; i < 12; i++) await Promise.resolve();
  if (kind === "hang")
    return { calls, currentSettled: settled, deployedSettled: true, equal: settled };
  await result;
  return { calls, addedGtcReads: calls.filter(value => value === "gtc-identity-read").length, equal: !calls.includes("gtc-identity-read") };
}
const deployedManual = await manualSequence(true, false);
const currentFokOnly = await manualSequence(false, false);
const deployedAfterCanceledManual = await manualSequence(true, true);
const currentAfterCanceledGtc = await manualSequence(false, true);
assert.deepEqual(currentFokOnly, deployedManual, "Control: actual deployed and current native FOK sequence");
// Both modes are bets in a common account pool. Compare equal manual actions:
// cancel one prompt, then submit FOK. Never compare one action to two actions.
assert.deepEqual(currentAfterCanceledGtc, deployedAfterCanceledManual, "Shared rotation follows the deployed manual selection/cancel rule");
assert(deployedManual.postedAccount, "The differential fixture must reach FOK submission");
const manual = {
  deployedManual,
  currentFokOnly,
  deployedAfterCanceledManual,
  currentAfterCanceledGtc,
  equal: deployedAfterCanceledManual.postedAccount === currentAfterCanceledGtc.postedAccount,
  interpretation: "Common account rotation is intentional across order modes. The deployed manual entry also picks before the amount prompt and advances rotation on cancellation.",
};
const findings = [
  { id: "manual-shared-rotation", evidence: manual, passed: manual.equal },
  ...await Promise.all(["normal", "hang", "failure"].map(async (kind) => {
    const evidence = await transportFault(kind);
    return { id: `order-transport-${kind}`, evidence, passed: evidence.equal };
  })),
];
const report = { version: snapshot.version, scope: "Actual manual entry + actual account picker and transport router; offline mocked external boundaries; no real submission or database mutation.", passed: findings.every(item => item.passed), findings };
fs.writeFileSync("output/fok-runtime-boundary-audit.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed)
  process.exitCode = 1;
