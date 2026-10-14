import { execFileSync } from "node:child_process";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as contract from "@changmen/shared/pm_gtc";
import * as financial from "./pm_gtc_financial.js";
import * as settlement from "./pm_gtc_settlement.js";
import * as snapshot from "./pm_gtc_order_snapshot.js";
import { historicalCompatibility as ordersCompatibility, historicalMinimal as minimalOrders } from "../../../../../scripts/verification/historical-order-storage.mjs";
import * as nativeOrders from "../../native_orders.js";

// [changmen 扩展] 本阶段之前的 mutatePmGtc 与此固定提交相同；不重录旧保护基线。
const path = "server/db/rds/orderModes/gtc/pm_gtc_store.js";
const before = execFileSync("git", ["show", `e901bb596952256284cd8a9eb8b73b572c963915:${path}`], { encoding: "utf8" });
const after = fs.readFileSync(path, "utf8");
const compatibleBefore = execFileSync("git", ["show", `3465fe5d3089e3935778e3e8eb4f8dd9709aa36d:${path}`], { encoding: "utf8" });
const json = value => JSON.parse(JSON.stringify(value));

async function run(source, row, command, failAt, onSnapshot, pending) {
  const queries = [];
  const query = async (sql, parameters) => {
    queries.push(json({ sql, parameters }));
    if (failAt && (sql.startsWith(failAt) || (sql.startsWith("WITH gtc_financial_target") && failAt === "INSERT INTO orders"))) throw new Error("injected original writer failure");
    return { rows: sql.startsWith("SELECT updated_at FROM pm_gtc_executions") ? [{ updated_at: 500 }]
      : sql.startsWith("SELECT record") ? [{ record: json(row) }]
      : sql.startsWith("SELECT id,order_id,execution_id") && pending ? [pending] : [] };
  };
  const dependencies = {
    "@changmen/shared/pm_gtc": contract,
    "../../common.js": { getPgPool: () => ({ query, connect: async () => ({ query, release: () => queries.push({ release: true }) }) }) },
    "./pm_gtc_financial.js": financial,
    "./pm_gtc_settlement.js": settlement,
    "./pm_gtc_order_snapshot.js": snapshot,
    "../../orders_execution_compat.js": ordersCompatibility,
    "../../native_orders.js": nativeOrders,
    "../../pm_orders_minimal.js": minimalOrders,
  };
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, require: id => {
    if (!(id in dependencies)) throw new Error(`unexpected dependency ${id}`);
    return dependencies[id];
  }, Date: class extends Date { static now() { return 500; } } });
  let result; let error;
  try { result = await exports.mutatePmGtc("owner", "id", row.revision, json(command)); }
  catch (failure) { error = failure.message; }
  // This is the only permitted payload addition; no SQL, money, status or execution-result normalization.
  for (const event of queries) {
    if (event.sql?.includes("INSERT INTO orders")) {
      onSnapshot?.(event.parameters[10].pmGtcOrderSnapshot);
      delete event.parameters[10].pmGtcOrderSnapshot;
    }
  }
  return json({ queries, result, error });
}

function accepted(provider = "RAY", source) {
  const plan = { shares: "10", orderHash: "hash", originalPmLeg: "A", playerId: 1, otherPlayerId: 2, otherProvider: provider, fx: 6.7, linkId: 123, ...(source ? { source } : {}) };
  const initial = contract.createGtcExecution("id", "owner", "wallet", "maker", plan, 1);
  return contract.applyGtcCommand(contract.applyGtcCommand(initial, { kind: "authorize_pm" }, 2), { kind: "ack", state: "accepted", orderId: "hash" }, 3);
}
const facts = () => ({ kind: "facts", facts: {
  order: { id: "hash", original: "10", matched: "10", status: "MATCHED", tradeIds: ["t"] },
  fills: [{ key: "t:maker", tradeId: "t", bucket: "maker", role: "MAKER", shares: "10", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 4 }], complete: true, observedAt: 4,
}, financialOrder: { pmShares: 10, pmFillPrice: 0.5, pmStakeUsdc: 5, pmFeeUsdc: 0, odds: 2, betMoney: 33.5 } });

describe("phase 2 preserves actual pre-phase mutation SQL, results and errors", () => {
  it("writes the additional snapshot on an existing financial-eligible partial fill", async () => {
    const command = facts();
    command.facts.order.matched = "5"; command.facts.order.status = "LIVE";
    command.facts.fills[0].shares = "5";
    command.financialOrder = { pmShares: 5, pmFillPrice: 0.5, pmStakeUsdc: 2.5, pmFeeUsdc: 0, odds: 2, betMoney: 16.75 };
    let written;
    const current = await run(after, accepted(), command, undefined, value => { written = value; });
    expect(current).toEqual(await run(before, accepted(), command));
    expect(written).toMatchObject({ requestedShares: "10", cumulativeMatchedShares: "5", openShares: "5", feeUsdc: "0", officialStatus: "LIVE" });
  });
  it("a later evidenced FAILED rollback updates the snapshot without reviving the previous quantity", async () => {
    const row = contract.applyGtcCommand(accepted(), facts(), 4);
    const command = facts(); command.facts.order.matched = "0"; command.facts.order.status = "CANCELED";
    command.facts.fills[0].status = "FAILED"; command.facts.fills[0].updatedAt = 6; command.facts.observedAt = 6;
    command.financialOrder = { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 };
    let written;
    expect(await run(after, row, command, undefined, value => { written = value; })).toEqual(await run(before, row, command));
    expect(written).toMatchObject({ cumulativeMatchedShares: "0", openShares: "0", officialStatus: "CANCELED" });
  });
  it.each(["manual", "unknown-counterpart"])("does not attach snapshot to %s financial orders", async scenario => {
    let written = "not-called";
    await run(after, accepted(scenario === "manual" ? "RAY" : "unknown", scenario === "manual" ? "manual" : undefined), facts(), undefined, value => { written = value; });
    expect(written).toBeUndefined();
  });
  it.each(["RAY", "OB", "PredictFun", "Polymarket", "unknown"])("keeps financial transaction trace for counterpart %s", async provider => {
    const row = accepted(provider);
    expect(await run(after, row, facts())).toEqual(await run(before, row, facts()));
  });
  it("keeps manual GTC outside the snapshot change", async () => {
    expect(await run(after, accepted("RAY", "manual"), facts())).toEqual(await run(before, accepted("RAY", "manual"), facts()));
  });
  it.each(["authorize_pm", "authorize_other", "ack", "close"])("does not add zero-fill writes or change %s coordination", async kind => {
    const row = kind === "authorize_pm" ? contract.createGtcExecution("id", "owner", "wallet", "maker", accepted().plan, 1) : accepted();
    if (kind === "authorize_other") row.plan.parallel = true;
    const command = kind === "ack" ? { kind, state: "accepted", orderId: "hash" } : { kind };
    const current = await run(after, row, command);
    expect(current).toEqual(await run(before, row, command));
    expect(current.queries.some(event => event.sql?.startsWith("INSERT INTO orders"))).toBe(false);
  });
  it.each(["INSERT INTO orders", "UPDATE pm_gtc_executions", "COMMIT"])("keeps original failure/rollback semantics at %s", async failure => {
    expect(await run(after, accepted(), facts(), failure)).toEqual(await run(before, accepted(), facts(), failure));
  });
  it("does not treat unknown fees as financial eligibility", async () => {
    const command = facts(); command.facts.fills[0].fee = null; delete command.financialOrder;
    const current = await run(after, accepted(), command);
    expect(current).toEqual(await run(before, accepted(), command));
    expect(current.queries.some(event => event.sql?.startsWith("INSERT INTO orders"))).toBe(false);
  });
});

afterEach(() => vi.unstubAllEnvs());
it("historical enabled minimal projection retains its original transaction and failure evidence", async () => {
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", "0");
  vi.stubEnv("PM_ORDERS_MINIMAL", "1");
  await minimalOrders.preparePmOrdersMinimal({ query: async () => ({ rows: [{ valid: true }] }) });
  const row = accepted(); row.decision = "closed";
  const result = await run(compatibleBefore, row, facts());
  expect(result).toEqual(await run(compatibleBefore, row, facts()));
  expect(result.error).toBeUndefined();
  expect(result.queries.some(event => event.sql?.startsWith("SELECT updated_at FROM pm_gtc_executions"))).toBe(true);
  expect(result.queries.at(-2).sql).toBe("COMMIT");
  expect(await run(compatibleBefore, row, facts(), "SELECT updated_at FROM pm_gtc_executions"))
    .toEqual(await run(compatibleBefore, row, facts(), "SELECT updated_at FROM pm_gtc_executions"));
});
describe("historical orders merge preserves original GTC eligibility with no extra database round trips", () => {
  async function enable() {
    vi.stubEnv("ORDERS_EXECUTION_COMPAT", "1");
    await ordersCompatibility.prepareOrdersExecutionCompatibility({ query: async () => ({ rows: [{ valid: true }] }) });
  }
  it("promotes within the original write and retains complete command result, query count and parameters", async () => {
    const original = await run(before, accepted(), facts());
    await enable();
    const current = await run(compatibleBefore, accepted(), facts());
    expect(current.error).toBeUndefined();
    expect(current.result).toEqual(original.result);
    expect(current.queries.length).toBe(original.queries.length);
    const writes = current.queries.filter(q => q.sql?.includes("INSERT INTO orders"));
    expect(writes).toHaveLength(1);
    expect(writes[0].parameters).toEqual(original.queries.find(q => q.sql?.includes("INSERT INTO orders")).parameters);
    expect(writes[0].sql).toContain("financial_ready=true");
    expect(current.queries.some(q => q.sql?.startsWith("SELECT id,order_id,execution_id"))).toBe(false);
    expect(current.queries.at(-2).sql).toBe("COMMIT");
  });
  it("FAILED rollback retains original zero finance eligibility", async () => {
    const row = contract.applyGtcCommand(accepted(), facts(), 4);
    const command = facts();
    command.facts.order.matched = "0"; command.facts.order.status = "CANCELED";
    command.facts.fills[0].status = "FAILED"; command.facts.fills[0].updatedAt = 6; command.facts.observedAt = 6;
    command.financialOrder = { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 };
    const original = await run(before, row, command);
    await enable();
    const current = await run(compatibleBefore, row, command);
    expect(current.result).toEqual(original.result);
    expect(current.queries.length).toBe(original.queries.length);
    const insert = current.queries.find(q => q.sql?.includes("INSERT INTO orders"));
    expect(insert.parameters[8]).toBe(0);
    expect(insert.sql).toContain("financial_ready=true");
  });
  it.each(["unknown fee", "missing financial helper", "authorized zero fill", "invalid helper"])("%s never promotes or inserts", async (scenario) => {
    const command = scenario === "authorized zero fill" ? { kind: "authorize_other" } : facts();
    if (scenario === "unknown fee") command.facts.fills[0].fee = null;
    if (["unknown fee", "missing financial helper"].includes(scenario)) delete command.financialOrder;
    if (scenario === "invalid helper") command.financialOrder.betMoney += 1;
    const original = await run(before, accepted(), command);
    await enable();
    const current = await run(compatibleBefore, accepted(), command);
    expect(current.result).toEqual(original.result);
    expect(current.error).toEqual(original.error);
    expect(current.queries.length).toBe(original.queries.length);
    expect(current.queries.some(q => q.sql?.includes("financial_ready=true") || q.sql?.includes("INSERT INTO orders"))).toBe(false);
  });
  it.each(["INSERT INTO orders", "UPDATE pm_gtc_executions", "COMMIT"])("failure at %s keeps rollback and release behavior", async (failAt) => {
    await enable();
    const current = await run(compatibleBefore, accepted(), facts(), failAt);
    expect(current.result).toBeUndefined();
    expect(current.error).toBe("injected original writer failure");
    expect(current.queries.at(-2).sql).toBe("ROLLBACK");
    expect(current.queries.at(-1)).toEqual({ release: true });
  });
});
it.each(["1", "invalid"])("retired flags=%s cannot alter current financial SQL, results or rollback", async value => {
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", "0"); vi.stubEnv("PM_ORDERS_MINIMAL", "0");
  const original = await run(compatibleBefore, accepted(), facts());
  const originalFailure = await run(compatibleBefore, accepted(), facts(), "INSERT INTO orders");
  vi.stubEnv("ORDERS_EXECUTION_COMPAT", value); vi.stubEnv("PM_ORDERS_MINIMAL", value); vi.stubEnv("PM_ORDERS_MINIMAL_PROJECTION_WRITE", value);
  expect(await run(after, accepted(), facts())).toEqual(original);
  expect(await run(after, accepted(), facts(), "INSERT INTO orders")).toEqual(originalFailure);
});
