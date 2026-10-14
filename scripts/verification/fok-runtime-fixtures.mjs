// [changmen 扩展] 单独运行实际旧/新代码的离线差分，严格发布检查继续使用原入口。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const checkerPath = "scripts/verification/verify-fok-execution-parity.mjs";
const executePath = "client/web/src/stores/betting/autoBet/executeArbBet.ts";
const manualPath = "client/web/src/stores/betting/manualBet.ts";
export const manualIndependentBaseline = "89b87779";
const json = value => JSON.parse(JSON.stringify(value));
function slice(source, start, end) {
  const first = source.indexOf(start); const last = source.indexOf(end, first);
  assert(first >= 0 && last > first, `fixture markers missing: ${start} / ${end}`);
  return source.slice(first, last);
}
function sandbox(base, readFileSync = fs.readFileSync) {
  return { assert, execFileSync, fs: { ...fs, readFileSync }, vm, ts, base, executePath, console };
}

export function runGtcStateFixture(readFileSync) {
  const source = fs.readFileSync(checkerPath, "utf8");
  const loader = slice(source, "function load(file, old, context)", "async function execute(old, scenario)");
  const fixture = slice(source, "const storage = new Map();", "const before = gates();");
  const checks = `
    const row = { id: "late-fill", owner: "owner", complete: true, matched: "5", principal: "2.5", fee: "0",
      plan: { playerId: 91, betRowId: 92, target: "Home" }, other: { state: "not_attempted" } };
    const pristine = gates();
    runtime.markGtcLegOnce({ ...row, owner: "foreign" }, "PM");
    runtime.markGtcLegOnce({ ...row, complete: false }, "PM");
    runtime.markGtcLegOnce({ ...row, fee: null }, "PM");
    runtime.markGtcLegOnce({ ...row, matched: "0" }, "PM");
    runtime.markGtcLegOnce(row, "OTHER");
    assert.equal(storage.size, 0);
    // 同时保护已有的 FOK 限次/上次赔率/使用账号状态，不能只验证空状态。
    markers.markSuccessfulBet(account, 92, "Home", 2);
    const seeded = gates();
    const existing = [...storage.entries()];
    runtime.markGtcLegOnce(row, "PM");
    runtime.markGtcLegOnce(row, "PM");
    assert.deepEqual(gates(), seeded);
    for (const [key, value] of existing) assert.equal(storage.get(key), value);
    assert.equal(gtcMarkers.readGtcBetCount("owner", 91, 92, "Home"), 1);
    assert.equal(seeded.maxBetCountPasses, false);
    return { actualStateModule: "executionState.ts", pristine, seeded, after: gates(),
      gtcCount: 1, invalidAndDuplicateFillsChecked: true, keys: [...storage.keys()] };
  `;
  return json(vm.runInNewContext(`(() => { ${loader} ${fixture} ${checks} })()`, sandbox("219535c8", readFileSync), { timeout: 30000 }));
}

export async function runFokDifferentials(base) {
  const source = fs.readFileSync(checkerPath, "utf8");
  let loader = slice(source, "function load(file, old, context)", "async function execute(old, scenario)");
  // eslint-disable-next-line no-template-curly-in-string -- Literal source tokens in the reused VM loader.
  loader = loader.replace("`${base}:${file}`", "`${file === manualPath ? manualOldBase : base}:${file}`");
  const execute = slice(source, "async function execute(old, scenario)", "const rows = [];")
    .replace("const functions = {", "const functions = { syncActiveBetFail: () => { throw new Error(\"observation unavailable\"); },");
  const finalize = slice(source, "async function finalize(old, providers)", "const finalizeRows = [];");
  const manual = slice(source, "async function manual(old, scenario)", "const manualResults = [], knownManualDifferences = [];");
  const checks = `
    const autoRows = [], finalRows = [], manualRows = [], historicalManualRows = [];
    for (const [name, scenario] of scenarios) {
      const previous = await execute(true, scenario), current = await execute(false, scenario);
      assert.deepEqual(current, previous, name); autoRows.push({ name, equal: true, previous, current });
    }
    for (const providers of [["Polymarket", "OB"], ["Polymarket", "RAY"], ["RAY", "Polymarket"], ["RAY", "RAY"]]) {
      const previous = await finalize(true, providers), current = await finalize(false, providers);
      assert.deepEqual(current, previous); finalRows.push({ providers, equal: true, previous, current });
    }
    for (const [name, scenario] of manualCases) {
      const previous = await manual(true, scenario), current = await manual(false, scenario);
      assert.deepEqual(current, previous, name); manualRows.push({ name, equal: true, previous, current });
    }
    manualOldBase = base;
    for (const [name, scenario] of manualCases) {
      const previous = await manual(true, scenario), current = await manual(false, scenario);
      if (JSON.stringify(previous) !== JSON.stringify(current)) historicalManualRows.push({ name, previous, current });
    }
    assert.deepEqual(historicalManualRows.map(row => row.name), ["low balance", "account filter", "muted map", "prematch blocked"]);
    return { baseline: base, manualIndependentBaseline, autoRows, finalRows, manualRows, historicalManualRows };
  `;
  assert.equal(fs.readFileSync(manualPath, "utf8").replace(/\r\n/g, "\n"), execFileSync("git", ["show", `${manualIndependentBaseline}:${manualPath}`], { encoding: "utf8" }).replace(/\r\n/g, "\n"));
  return json(await vm.runInNewContext(`(async () => { let manualOldBase = manualIndependentBaseline; ${loader} ${execute} ${finalize} ${manual} ${checks} })()`, { ...sandbox(base), manualPath, manualIndependentBaseline }, { timeout: 30000 }));
}
