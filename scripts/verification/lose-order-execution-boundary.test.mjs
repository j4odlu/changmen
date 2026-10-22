import fs from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import { loseOrderExecutionExtraction as entry, restoreLoseOrderExecutionSource } from "./lose-order-execution-boundary.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { restoreMakeupCandidatesSource } from "./makeup-candidates-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");

it("retains the entire consumer body with only the injected late progress read", () => {
  const original = gitSource(entry.baseline, entry.file);
  expect(entry.before).toBe(original);
  const previousBody = original.slice(original.indexOf("  const config = user.config;"));
  const body = restoreMakeupCandidatesSource(entry.executionFile, read(entry.executionFile), read);
  expect(body.slice(body.indexOf("  const config = user.config;")))
    .toBe(previousBody.replace('useActiveBetRunStore().runs.get(betId)?.legs.find(l => l.target === order.target && l.status !== "skipped")?.side',
      "getMakeupSide(betId, order.target)"));
});

it("keeps global store acquisition in the original entry", () => {
  const execution = read(entry.executionFile);
  const tree = ts.createSourceFile("execution.ts", execution, ts.ScriptTarget.Latest, true);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^use.*Store$/.test(node.expression.text))
      calls.push(node.expression.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  expect(calls).toEqual([]);
  expect(restoreLoseOrderExecutionSource(entry.file, read(entry.file), read)).toBe(entry.before);
  expect(restoreLoseOrderExecutionSource(entry.file, entry.before, read)).toBe(entry.before);
});

it("rejects altered dependency binding and added entry behavior", () => {
  const source = read(entry.file);
  for (const changed of [source.replace("    accountStore,", "    accountStore: {},"), source + "\nvoid unexpectedRun();\n"]) {
    expect(changed).not.toBe(source);
    expect(() => restoreLoseOrderExecutionSource(entry.file, changed, read)).toThrow(/dependency assembly/);
  }
});

it.each([
  source => source.replace("if (!config.makeUp)", "if (false)"),
  source => source.replace("loseStore.orders.get(betId) !== order", "false"),
  source => source.replace("if (!isCurrentOrder && !result?.success)", "if (!isCurrentOrder)"),
  source => source.replace("await accountStore.betting(", "void accountStore.betting("),
])("rejects changed execution gates, cancellation protection and submission waits", (alter) => {
  const source = read(entry.executionFile);
  expect(alter(source)).not.toBe(source);
  expect(() => restoreLoseOrderExecutionSource(entry.file, read(entry.file),
    file => file === entry.executionFile ? alter(source) : read(file))).toThrow(/extracted lose-order execution/);
});
