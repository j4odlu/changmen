import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { arbMakeUpPolicyExtraction as entry, restoreArbMakeUpPolicySource } from "./arb-makeup-policy-boundary.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";

const read = file => fs.readFileSync(file, "utf8");

it("restores the entire pre-extraction module without changing the fixed historical baselines", () => {
  const original = gitSource(entry.baseline, entry.file);
  expect(restoreArbMakeUpPolicySource(entry.file, read(entry.file), read)).toBe(original);
  expect(restoreArbMakeUpPolicySource(entry.file, original, read)).toBe(original);
});

it.each([
  source => source.replace("}, decision.side)", '}, "A")'),
  source => source.replace('role === "target" ? pendingSide', 'role === "anchor" ? pendingSide'),
  source => source.replace("result.enqueuedForLegA = queued", "result.enqueuedForLegA = false"),
  source => source + "\nvoid unexpectedMakeup();\n",
])("rejects changes outside the exact extraction", (alter) => {
  const source = read(entry.file);
  expect(alter(source)).not.toBe(source);
  expect(() => restoreArbMakeUpPolicySource(entry.file, alter(source), read)).toThrow();
});

it("checks the whole extracted policy, including the pending-role rules", () => {
  const policy = read(entry.policyFile);
  const changed = policy.replace("resultB?.success && !rejectB", "resultB?.success");
  expect(changed).not.toBe(policy);
  expect(() => restoreArbMakeUpPolicySource(entry.file, read(entry.file),
    file => file === entry.policyFile ? changed : read(file))).toThrow(/complete extracted makeup policy/);
});

function loadModule(source, imports = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    Date: { now: () => 12345 },
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected policy dependency: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

it("preserves original results and side-effect order across 10368 execution-state combinations", async () => {
  const pair = loadModule(read("client/web/src/stores/betting/autoBet/arbMakeUpPair.ts"));
  const policy = loadModule(read(entry.policyFile), { "@/stores/betting/autoBet/arbMakeUpPair": pair });
  const accountMultiply = loadModule(read("packages/shared/account_multiply.ts"));
  function executor(source) {
    let trace;
    let allowed;
    let throwEnqueue;
    const store = {
      orders: new Map(),
      createOrder: order => trace.push(["create", order]),
      setPendingVenueOrder: (...args) => trace.push(["pending", ...args]),
    };
    const imports = {
      "@changmen/shared/account_multiply": accountMultiply,
      "@changmen/shared/pm_submission": { pmSubmissionFromResult: (result, accountId) => ({ orderId: result?.orderId, accountId }) },
      "@/models/loseOrder": { LoseOrder: class { constructor(raw) { Object.assign(this, raw); } } },
      "@/stores/betting/autoBet/arbMakeUpPair": pair,
      "@/stores/betting/autoBet/arbMakeUpPolicy": policy,
      "@/stores/betting/autoBet/makeUp": { enqueueMakeUpOrder: async (params) => {
        const { loseStore: _store, match: _match, bet: _bet, config: _config, setMessage: _message, ...request } = params;
        trace.push(["enqueue", request]);
        if (throwEnqueue) throw new Error("admission query failed");
        return allowed;
      } },
      "@/stores/betting/makeUpReference": { resolveMakeUpSuccessReference: (leg, orders, rejected, account, orderId) => {
        trace.push(["reference", leg.target, orders, rejected, account.accountId, orderId]);
        return { betMoney: leg.betMoney, betOdds: leg.odds };
      } },
      "@/stores/loseOrderStore": { useLoseOrderStore: () => store },
    };
    imports["@/stores/betting/autoBet/arbMakeUpPending"] = loadModule(
      read("client/web/src/stores/betting/autoBet/arbMakeUpPending.ts"), imports);
    imports["@/stores/betting/autoBet/arbMakeUpEnqueue"] = loadModule(
      read("client/web/src/stores/betting/autoBet/arbMakeUpEnqueue.ts"), imports);
    const module = loadModule(source, imports);
    return async (placed, rejectA, rejectB, pending, scenario) => {
      trace = [];
      allowed = scenario.allowed;
      throwEnqueue = scenario.throwEnqueue;
      store.orders = scenario.existing ? new Map([[100, {}]]) : new Map();
      try {
        const result = await module.applyArbMakeUpFromRejects({
          match: { id: 1, title: "A vs B" }, bet: { id: 100, getBetName: () => "map1" }, config: {}, setMessage: () => {},
        }, placed, rejectA, rejectB, { ordersA: [], ordersB: [] }, pending);
        return JSON.stringify({ result, trace });
      }
      catch (error) {
        return JSON.stringify({ error: error.message, trace });
      }
    };
  }
  const before = executor(gitSource(entry.baseline, entry.file));
  const after = executor(read(entry.file));
  const outcomes = [undefined, { success: true }, { success: false }, { success: true, reject: "timeout" },
    { success: true, reject: "unfilled" }, { success: false, pmSubmitUnknown: true }]
    .map(result => result && Object.freeze({ orderId: "original-order", ...result }));
  const scenarios = [
    { allowed: true }, { allowed: false }, { allowed: true, existing: true },
    { allowed: true, missingA: true }, { allowed: true, missingB: true }, { allowed: true, missingReceipt: true },
    { allowed: true, unsupportedA: true }, { allowed: true, unsupportedB: true }, { allowed: true, throwEnqueue: true },
  ];
  let count = 0;
  for (const resultA of outcomes) for (const resultB of outcomes) for (let flags = 0; flags < 32; flags++) for (const scenario of scenarios) {
    const placed = {
      betBothLegs: Boolean(flags & 1),
      resultA: scenario.missingReceipt && resultA ? { ...resultA, orderId: null } : resultA,
      resultB: scenario.missingReceipt && resultB ? { ...resultB, orderId: null } : resultB,
      accountA: scenario.missingA ? undefined : { accountId: 14, provider: scenario.unsupportedA ? "RAY" : "Polymarket" },
      accountB: scenario.missingB ? undefined : { accountId: 23, provider: scenario.unsupportedB ? "OB" : "PredictFun" },
      legA: { target: "Home", type: "Polymarket", betMoney: 25, odds: 2.5, betId: "A" },
      legB: { target: "Away", type: "PredictFun", betMoney: 40, odds: 1.7, betId: "B" },
      linkId: 1000,
    };
    const args = [placed, Boolean(flags & 2), Boolean(flags & 4),
      { pendingConfirmA: Boolean(flags & 8), pendingConfirmB: Boolean(flags & 16) }, scenario];
    const expected = await before(...args);
    expect(await after(...args), JSON.stringify({ resultA, resultB, flags, scenario })).toBe(expected);
    count++;
  }
  expect(count).toBe(10368);
});
