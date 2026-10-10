import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
// [changmen 扩展] 永久固定到加入 GTC 配置前；需要本地 Git 保留此基线提交。
const base = process.env.FOK_PARITY_BASELINE ?? "219535c8";
fs.mkdirSync("output", { recursive: true });
const executePath = "client/web/src/stores/betting/autoBet/executeArbBet.ts";
const normalizeSource = text => text.replace(/\r\n/g, "\n");
const exactFiles = [
  "server/db/rds/orders_store.js",
  "server/backend/core/account/order/link.js",
  "client/web/src/shared/orderLink.ts",
  "client/web/src/stores/betting/autoBet/phases/finalizeArbBet.ts",
  ...["runtime.ts", "match.ts", "autoMakeup.ts", "types.ts"].map(file => `client/web/src/extensions/arbBet/rayRejectMonitor/${file}`),
  "client/web/src/stores/betting/successMarkers.ts",
  "client/web/src/shared/betTiming.ts",
  "client/web/src/domain/betting/betFilters.ts",
  "client/web/src/domain/betting/singleLegRate.ts",
  ...["prepareArbAttempt.ts", "checkArbLegs.ts", "placeArbLegs.ts", "settleBothArbLegs.ts", "finalizeArbMarkers.ts"].map(file => `client/web/src/stores/betting/autoBet/phases/${file}`),
  ...["arbLegSettle.ts", "arbMakeUpFromRejects.ts", "retryFailedLeg.ts"].map(file => `client/web/src/stores/betting/autoBet/${file}`),
  "client/web/src/stores/account/venueOrders.ts",
  "client/web/src/stores/betting/pendingOrderBind.ts",
  "packages/venue-adapter/polymarket/pmSubmitJournal.ts",
  "packages/venue-adapter/polymarket/pmManualSell.ts",
  "packages/venue-adapter/polymarket/bet.ts",
  "client/web/src/stores/account/betGateway.ts",
  "client/web/src/stores/account/pmManualSell.ts",
  "client/web/src/stores/orderStore.ts",
  "client/web/src/api/order.ts",
  "client/web/src/components/order/OrderView.vue",
  "client/web/src/stores/betting/autoBet/executeArbBet.ts",
  "client/web/src/runtime/appSession.ts",
  "packages/venue-adapter/polymarket/pmFee.ts",
  "packages/venue-adapter/polymarket/pmPostFillOrder.ts",
  "packages/venue-adapter/polymarket/orders.ts",
  "packages/shared/currency.ts",
  "server/backend/core/account/order/save_pm.js",
  "client/web/src/stores/account/accountPicker.ts",
  "client/web/src/stores/accountStore.ts",
  "client/web/src/models/platformAccount.ts",
  "client/web/src/stores/messageStore.ts",
  "client/web/src/shared/pmOrderDisplay.ts",
  "client/web/src/shared/pfOrderDisplay.ts",
  "client/web/src/domain/polymarket/tickBufferQuote.ts",
];

for (const file of exactFiles) {
  assert.equal(normalizeSource(fs.readFileSync(file, "utf8")), normalizeSource(execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" })), file);
}
// OrderList is shared by both modes. Optional details and amount slot preserve the original fallback.
const sharedOrderList = "client/web/src/components/order/OrderList.vue";
const originalOrderList = normalizeSource(execFileSync("git", ["show", `${base}:${sharedOrderList}`], { encoding: "utf8" }));
const ordinaryOrderList = normalizeSource(fs.readFileSync(sharedOrderList, "utf8"))
  .replace(/^import OrderModeDetails[^\n]*\n/m, "")
  .replace(/^\s*<OrderModeDetails[^\n]*\n/m, "")
  .replace("<slot name=\"buy-amount\" :row=\"block.row\">{{ toFixed(pmOrderStakeDisplayCny(block.row), 0) }}</slot>", "{{ toFixed(pmOrderStakeDisplayCny(block.row), 0) }}");
assert.equal(ordinaryOrderList, originalOrderList, "ordinary OrderList preserved around optional execution details");
for (const name of ["arbEarlyLockSell.ts", "arbFailAutoSell.ts"]) {
  const file = `client/web/src/extensions/arbBet/${name}`;
  const source = normalizeSource(fs.readFileSync(file, "utf8")).replace("from \"@/orderModes/fok/financialOrders\"", "from \"@/stores/orderStore\"");
  assert.equal(source, normalizeSource(execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" })), `${name}: unchanged FOK automation with source-filtered common orders`);
}
const printer = ts.createPrinter({ removeComments: true });
function methodBodies(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); const found = new Map();
  function visit(node, scope = "") {
    let next = scope;
    if (ts.isVariableDeclaration(node) && node.name)
      next = node.name.getText(sf);
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body)
      found.set((ts.isMethodDeclaration(node) ? `${scope}.` : "") + node.name.getText(sf), printer.printNode(ts.EmitHint.Unspecified, node.body, sf));
    ts.forEachChild(node, n => visit(n, next));
  }
  visit(sf); return found;
}
const pmFile = "packages/venue-adapter/polymarket/bet.ts";
const beforePm = methodBodies(pmFile, execFileSync("git", ["show", `${base}:${pmFile}`], { encoding: "utf8" }));
const currentPm = methodBodies(pmFile, fs.readFileSync(pmFile, "utf8"));
for (const [name, body] of beforePm) assert.equal(currentPm.get(name), body, `PM FOK: ${name}`);
const oldManual = execFileSync("git", ["show", `${base}:client/web/src/stores/betting/manualBet.ts`], { encoding: "utf8" });
const currentManual = fs.readFileSync("client/web/src/orderModes/fok/manual.ts", "utf8");
function manualTail(text) {
  const suffix = text.slice(text.indexOf("  const toastSec = manualBetToastSeconds();"));
  return methodBodies("manual.ts", `async function fok(){\n${suffix}`).get("fok");
}
assert.equal(manualTail(currentManual), manualTail(oldManual), "original manual FOK execution body");
// Verify the complete manual entry, including account pick, quote, amount, filters and balance.
// Only specialize the explicit FOK selection and replace the neutral dispatch with its actual executor.
const oldManualSf = ts.createSourceFile("manual.ts", oldManual, ts.ScriptTarget.Latest, true);
const entrySf = ts.createSourceFile("manual.ts", fs.readFileSync("client/web/src/stores/betting/manualBet.ts", "utf8"), ts.ScriptTarget.Latest, true);
const executorSf = ts.createSourceFile("fok.ts", currentManual, ts.ScriptTarget.Latest, true);
const oldEntry = oldManualSf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "runManualBet");
const entry = entrySf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "runManualBet");
const executor = executorSf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "executeManualFok");
const tailStart = executor.body.statements.findIndex(node => node.getText(executorSf).startsWith("const toastSec ="));
const tail = executor.body.statements.slice(tailStart);
let promptExpression;
function findPrompt(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(entrySf) === "promptMessage")
    promptExpression = node.initializer;
  ts.forEachChild(node, findPrompt);
}
findPrompt(entry);
const specialized = ts.transform(entry, [(context) => {
  const visit = (node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ["pmOrderMode", "selection", "promptMessage"].includes(declaration.name.getText(entrySf))))
      return undefined;
    if (ts.isIdentifier(node) && node.text === "promptMessage")
      return promptExpression;
    // The mutable executor parameter is lifted back into the original function scope.
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(entrySf) === "option"))
      return context.factory.updateVariableStatement(node, node.modifiers, context.factory.createVariableDeclarationList(node.declarationList.declarations, ts.NodeFlags.Let));
    if (ts.isIfStatement(node) && ts.isBlock(node.thenStatement) && node.thenStatement.statements.length === 1 && ts.isReturnStatement(node.thenStatement.statements[0]))
      return context.factory.updateIfStatement(node, node.expression, node.thenStatement.statements[0], node.elseStatement);
    if (ts.isConditionalExpression(node) && node.whenTrue.getText(entrySf).startsWith("h(PmManualOrderPrompt"))
      return ts.visitNode(node.whenFalse, visit);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && node.left.getText(entrySf) === "selection.orderMode === \"FOK\"")
      return ts.visitNode(node.right, visit);
    if (ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression) && ts.isCallExpression(node.expression.expression) && node.expression.expression.expression.getText(entrySf) === "executeManualOrder")
      return tail;
    return ts.visitEachChild(node, visit, context);
  };
  return node => ts.visitNode(node, visit);
}]);
// Compare printed code without source offsets: statements originate in two independent files.
const cleanPrint = (node, source) => printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\s+/g, " ").trim();
const oldStatements = oldEntry.body.statements.map(node => cleanPrint(node, oldManualSf));
const combinedStatements = specialized.transformed[0].body.statements.map(node => cleanPrint(node, tail.includes(node) ? executorSf : entrySf));
assert.deepEqual(combinedStatements, oldStatements, "complete manual entry under FOK selection matches VPS, including all preparation and failure gates");
specialized.dispose();
const orchestration = fs.readFileSync(executePath, "utf8");
assert(!orchestration.includes("useUserStore") && !orchestration.includes("\"GTC\"") && !orchestration.includes("pmGtc/"), "orchestration cannot choose PM mode or import its execution module");
process.stdout.write(`${JSON.stringify({ baseline: base, exactCoreFiles: exactFiles.length, pmFunctionBodies: beforePm.size, manualFokBodyIdentical: true })}\n`);

function load(file, old, context) {
  const source = old ? execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }) : fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}; const sandbox = vm.createContext({ ...context, exports, module: { exports }, console });
  vm.runInContext(js, sandbox, { filename: file, timeout: 1000 }); return exports;
}
async function execute(old, scenario) {
  const trace = []; const push = (kind, data) => trace.push({ kind, ...(data !== undefined ? { data: JSON.parse(JSON.stringify(data)) } : {}) });
  const ready = { linkId: 123, betBothLegs: !scenario.single, singleLegByRate: Boolean(scenario.single), singleLeg9999MapReserved: Boolean(scenario.single), singleLeg9999MapKeys: scenario.single ? ["same"] : undefined, legA: { type: "Polymarket" }, legB: { type: scenario.noPm ? "OB" : "RAY" } };
  if (scenario.noPm)
    ready.legA.type = "PB";
  const params = { match: { id: 1, title: "M", round: 0 }, bet: { id: 2, round: 1 }, config: {}, setMessage: m => push("message", m) };
  const functions = {
    isPrematchFullMarketAllowed: () => !scenario.blockPrematch,
    isMapMuteActive: () => Boolean(scenario.mute),
    prepareArbAttempt: async (p) => {
      push("prepare", p); if (scenario.throw === "prepare")
        throw new Error("prepare failed"); return scenario.noPrepare ? null : ready;
    },
    beginExecutionObservation: (r) => { push("begin", r); return { id: "same" }; },
    checkArbLegs: async (p, r) => {
      push("check", { p, r }); if (scenario.throw === "check")
        throw new Error("check failed"); return scenario.noCheck ? null : ready;
    },
    placeArbLegs: async (p, r) => {
      push("place", { p, r }); if (scenario.throw === "place")
        throw new Error("place failed"); return { linkId: 123, resultA: "same", resultB: "same" };
    },
    finalizeArbBet: async (p, r) => {
      push("finalize", { p, r }); if (scenario.throw === "finalize")
        throw new Error("finalize failed");
    },
    releaseSingleLeg9999MapFill: (...x) => push("release", x),
    releaseSingleLeg9999MapFillKeys: (...x) => push("releaseKeys", x),
    recordArbAttemptMetric: x => push("metric", x),
    finishExecutionObservation: (...x) => push("finish", x),
    getActivePinia: () => ({}),
    useUserStore: () => ({ userId: "owner", extensionPrefs: { pmArbOrderMode: scenario.mode || "FOK", pmGtcV1Participant: true, pmGtcV1Activation: scenario.activation } }),
  };
  let perf = 0;
  const context = { Date: class extends Date {static now() { return 1700000000000; }}, performance: { now: () => perf++ }, Error };
  const modules = new Map();
  const requireModule = (name) => {
    const own = {
      "@/stores/betting/execution/selection": "client/web/src/stores/betting/execution/selection.ts",
    }[name];
    if (!own)
      return functions;
    if (!modules.has(own))
      modules.set(own, load(own, false, { ...context, require: requireModule }));
    return modules.get(own);
  };
  const module = load(executePath, old, { ...context, require: requireModule });
  await module.executeArbBet(params); return trace;
}
const scenarios = [
  ["ordinary full success", {}],
  ["FOK with stale activation", { activation: "1:owner" }],
  ["legacy GTC preference without activation", { mode: "GTC" }],
  ["different-owner activation", { mode: "GTC", activation: "1:foreign" }],
  ["prepare returns null", { noPrepare: true }],
  ["check returns null", { noCheck: true }],
  ["prepare exception", { throw: "prepare" }],
  ["check exception", { throw: "check" }],
  ["place exception", { throw: "place" }],
  ["finalize exception", { throw: "finalize" }],
  ["single leg 9999", { single: true }],
  ["non-PM pair", { noPm: true }],
  ["prematch filter blocks", { blockPrematch: true }],
  ["muted map", { mute: true }],
  ["single 9999 check rejected", { single: true, noCheck: true }],
  ["single 9999 check exception", { single: true, throw: "check" }],
  ["direct FOK executor ignores GTC preference for single 9999", { mode: "GTC", activation: "1:owner", single: true }],
  ["direct FOK executor ignores GTC preference for non-PM pairs", { mode: "GTC", activation: "1:owner", noPm: true }],
];
const rows = [];
for (const [name, scenario] of scenarios) {
  const previous = await execute(true, scenario); const current = await execute(false, scenario);
  assert.deepEqual(current, previous, name);
  rows.push({ name, equal: true, eventCount: current.length, events: current.map(e => e.kind) });
}
fs.writeFileSync("output/execution-refactor-fok-execute-differential-fixed-20261010.json", `${JSON.stringify({ baseline: base, scope: "actual old/current executeArbBet; identical mocks and clock; compares phase order, payloads, metrics, release, exception handling and final observation. Real finalize is compared separately below.", cases: rows }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ casesPassed: rows.length, cases: rows }, null, 2)}\n`);

async function finalize(old, providers) {
  const trace = []; const push = (kind, data) => trace.push({ kind, ...(data ? { data: JSON.parse(JSON.stringify(data)) } : {}) });
  const params = { match: { id: 1, title: "M" }, bet: { id: 2, round: 1, getBetName: () => "market" }, config: { makeUp: false } };
  const leg = (type, target) => ({ type, target, betMoney: 100, odds: 2, matchId: "m", betId: "b", itemId: "i" });
  const placed = { linkId: 1700000000000, betBothLegs: true, legA: leg(providers[0], "Home"), legB: leg(providers[1], "Away"), accountA: { accountId: 1, provider: providers[0] }, accountB: { accountId: 2, provider: providers[1] }, resultA: { success: true, orderId: "a" }, resultB: { success: true, orderId: "b" } };
  const settled = { ordersA: [{ orderId: "a", status: "none" }], ordersB: [{ orderId: "b", status: "none" }], rejectA: false, rejectB: false, pendingConfirmA: false, pendingConfirmB: false };
  const funcs = {
    settleBothArbLegs: async () => { push("settle"); return settled; },
    registerRayRejectMonitor: x => push("register_ray", { side: x.side, initialDetectionPending: x.initialDetectionPending ?? false, anchorConfirmed: x.anchorConfirmed }),
    resolveArbMakeUpSuccessRef: () => ({ betMoney: 100, betOdds: 2 }),
    applyArbMakeUpFromRejects: async () => { push("makeup"); return {}; },
    logArbFinalizeTraceEvents: () => push("trace"),
    markArbSuccessLegs: () => push("mark"),
    refreshOrderListAfterBind: () => push("refresh"),
    syncArbFinalizeActiveBet: () => { push("sync"); return "success"; },
    finishArbExecutionTrace: () => push("finish"),
    sendArbBettingMessageIfNeeded: () => push("message"),
    useUserStore: () => ({ extensionPrefs: { arbFailAutoSell: { enabled: false } } }),
  };
  const module = load("client/web/src/stores/betting/autoBet/phases/finalizeArbBet.ts", old, { require: () => funcs, Date: class extends Date {static now() { return 1700000000000; }}, Error });
  await module.finalizeArbBet(params, placed); return trace;
}
const finalizeRows = [];
for (const providers of [["Polymarket", "OB"], ["Polymarket", "RAY"], ["RAY", "Polymarket"], ["RAY", "RAY"]]) {
  const previous = await finalize(true, providers); const current = await finalize(false, providers);
  const equal = JSON.stringify(previous) === JSON.stringify(current);
  assert.equal(equal, true);
  finalizeRows.push({ providers, equal, previous, current });
}
fs.writeFileSync("output/execution-refactor-fok-finalize-differential-fixed-20261010.json", `${JSON.stringify({ baseline: base, cases: finalizeRows }, null, 2)}\n`);
const storage = new Map();
const context = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }, require: () => ({}), Error };
const timing = load("client/web/src/shared/betTiming.ts", false, context);
const markers = load("client/web/src/stores/betting/successMarkers.ts", false, { ...context, require: () => timing });
const gtcMarkers = load("client/web/src/orderModes/gtc/successMarkers.ts", false, context);
const account = { accountId: 91, provider: "Polymarket", maxBetCount: 1, lastOdds: true };
const gtc = load("packages/shared/pm_gtc.ts", false, context);
const runtime = load("client/web/src/orderModes/gtc/runtime.ts", false, { ...context, require: (name) => {
  if (name === "@changmen/shared/pm_gtc")
    return gtc;
  if (name === "vue")
    return { reactive: x => x };
  if (name === "@/stores/accountStore")
    return { useAccountStore: () => ({ findAccount: () => account }) };
  if (name === "@/stores/betting/successMarkers")
    return markers;
  if (name === "./successMarkers")
    return gtcMarkers;
  if (name === "@/stores/userStore")
    return { useUserStore: () => ({ userId: "owner", extensionPrefs: { pmArbOrderMode: "FOK", pmGtcV1Participant: true } }) };
  return {};
} });
function gates() {
  return { betCount: timing.readBetCount(91, 92, "Home"), lastOdds: timing.getLastBetOdds(91, 92, "Home") ?? null, maxBetCountPasses: timing.passesMaxBetCount(account, 92, "Home"), lastOddsPasses: timing.passesLastOddsGate(account, 92, "Home", 1.8), usedAccounts: markers.readUsedAccounts(92, "Home") };
}
const before = gates();
runtime.markGtcLegOnce({ id: "old-gtc", owner: "owner", complete: true, matched: "5", principal: "2.5", fee: "0", plan: { playerId: 91, betRowId: 92, target: "Home" }, other: { state: "not_attempted" } }, "PM");
const after = gates();
assert.deepEqual(after, before);
assert.equal(before.maxBetCountPasses, true); assert.equal(after.maxBetCountPasses, true);
assert.equal(before.lastOddsPasses, true); assert.equal(after.lastOddsPasses, true);
assert.equal(gtcMarkers.readGtcBetCount("owner", 91, 92, "Home"), 1);
assert.equal([...storage.keys()].some(key => key.startsWith("BETCOUNT:") || key.startsWith("BETACCOUNT:")), false);
fs.writeFileSync("output/execution-refactor-fok-gtc-isolated-state-fixed-20261010.json", `${JSON.stringify({
  scope: "actual repaired GTC markGtcLegOnce, GTC successMarkers and unchanged actual FOK successMarkers/betTiming modules with mocked user/account and storage; current user mode is FOK.",
  before,
  after,
  gtcCount: gtcMarkers.readGtcBetCount("owner", 91, 92, "Home"),
  keysWritten: [...storage.keys()],
  finding: "Late/recovered GTC fills write only independent GTC history. FOK count/account/lastOdds state and filter results remain unchanged.",
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ finalizeComparisons: finalizeRows.map(x => ({ providers: x.providers, equal: x.equal, previous: x.previous.map(e => e.kind), current: x.current.map(e => e.kind) })), sharedGates: { before, after } }, null, 2)}\n`);

// [changmen 扩展] 实际旧/新手动入口及新执行模块：只将新增模式选择 UI 归一化为同一正文。
async function manual(old, scenario) {
  const trace = [];
  const push = (kind, data) => trace.push({ kind, ...(data === undefined ? {} : { data: JSON.parse(JSON.stringify(data)) }) });
  const provider = scenario.provider || "Polymarket";
  const account = { provider, accountId: 1, getBalance: () => scenario.lowBalance ? 1 : 1000 };
  const store = {
    getAccount: (...args) => { push("account", args); return scenario.noAccount ? undefined : account; },
    checkBetting: async (a, o, opts) => {
      push("check", { a, o, opts }); if (scenario.throw === "check")
        throw new Error("check failed");
      o.data = scenario.noCheck ? null : {}; o.checkError = scenario.noCheck ? "blocked" : undefined; return o;
    },
    betting: async (a, o, seconds) => {
      push("bet", { a, o, seconds }); if (scenario.throw === "bet")
        throw new Error("bet failed");
      return { success: !scenario.reject, orderId: scenario.noId ? null : "order", pending: Boolean(scenario.pending), tip: { pmOptimisticSaved: !scenario.noOptimistic }, message: scenario.reject ? "rejected" : undefined };
    },
    updateVenueOrders: async (...args) => {
      push("sync", args); if (scenario.throw === "sync")
        throw new Error("sync failed"); return [];
    },
    refreshBalance: async (...args) => push("balance", args),
  };
  const functions = {
    BetOption: class { constructor(m, b, i, side, amount) { Object.assign(this, { type: i.type, betMoney: amount, target: side, betId: i.betId, itemId: "token" }); } },
    h: (_type, props) => ({ context: props.context }),
    ref: value => ({ value }),
    useAccountStore: () => store,
    useUserStore: () => ({ config: { betMoney: 10 } }),
    useMatchStore: () => ({}),
    isMapMuteActive: () => Boolean(scenario.mute),
    isPrematchFullMarketAllowed: () => !scenario.blockPrematch,
    capturePmPriceQuote: (o, odds) => { push("quote", { o, odds }); return scenario.quoteError ? { message: "quote failed" } : { ok: true }; },
    accountPassesMainBetFilter: () => !scenario.filtered,
    readValueBetMoney: () => 0,
    buildManualBetContextLines: () => ["context"],
    buildManualBetCheckFailureHtml: (...args) => JSON.stringify(args),
    manualBetToastSeconds: () => { push("toast"); return 5; },
    isPendingConfirmVenueProvider: p => ["Polymarket", "PredictFun", "RAY"].includes(p),
    markSuccessfulBet: (...args) => push("mark", args),
    refreshOrderListAfterBind: () => push("refresh"),
    wait: async ms => push("wait", ms),
    ElMessageBox: {
      prompt: async (message, title, opts) => {
        push("prompt", { message: typeof message === "string" ? message : message.context, title, opts }); if (scenario.cancel)
          throw new Error("cancel"); return { value: "25" };
      },
      alert: async (...args) => push("alert", args),
    },
  };
  const paths = {
    "@/orderModes/fok/manual": "client/web/src/orderModes/fok/manual.ts",
    "@/stores/betting/execution/manual": "client/web/src/stores/betting/execution/manual.ts",
    "@/stores/betting/execution/selection": "client/web/src/stores/betting/execution/selection.ts",
  };
  const modules = new Map();
  const requireModule = (name) => {
    if (!paths[name])
      return functions;
    if (!modules.has(name))
      modules.set(name, load(paths[name], false, { require: requireModule, Error }));
    return modules.get(name);
  };
  const module = load("client/web/src/stores/betting/manualBet.ts", old, { require: requireModule, Error });
  try {
    await module.runManualBet({ id: 1, title: "M", liveRound: 0 }, { id: 2, round: 1 }, { type: provider, betId: "condition", getOdds: () => 2 }, "Home", { setMessage: m => push("message", m) });
  }
  catch (error) { push("error", error.message); }
  return trace;
}
const manualCases = [
  ["PM matched optimistic", {}],
  ["PM matched requires correction", { noOptimistic: true }],
  ["PM pending", { pending: true }],
  ["PM pending without ID", { pending: true, noId: true }],
  ["RAY accepted", { provider: "RAY" }],
  ["PredictFun pending", { provider: "PredictFun", pending: true }],
  ["OB accepted", { provider: "OB" }],
  ["explicit rejection", { reject: true }],
  ["precheck rejected", { noCheck: true }],
  ["precheck throws", { throw: "check" }],
  ["POST throws", { throw: "bet" }],
  ["sync throws", { throw: "sync", pending: true }],
  ["no account", { noAccount: true }],
  ["low balance", { lowBalance: true }],
  ["account filter", { filtered: true }],
  ["prompt canceled", { cancel: true }],
  ["quote failed", { quoteError: true }],
  ["muted map", { mute: true }],
  ["prematch blocked", { blockPrematch: true }],
];
const manualResults = [];
for (const [name, scenario] of manualCases) {
  const previous = await manual(true, scenario); const current = await manual(false, scenario);
  assert.deepEqual(current, previous, `manual FOK: ${name}`);
  manualResults.push({ name, equal: true, trace: current });
}
fs.writeFileSync("output/execution-refactor-manual-fok-parity.json", `${JSON.stringify({ baseline: base, scope: "Actual old/current runManualBet and actual extracted FOK execution with identical mocked boundaries; PM prompt selection UI normalized to its context text only.", cases: manualResults }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ manualFokCasesPassed: manualResults.length })}\n`);

await import("./verify-fok-shared-boundaries.mjs");
