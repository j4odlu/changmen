import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import ts from "typescript";

const base = process.env.FOK_PARITY_BASELINE ?? "219535c8";
const printer = ts.createPrinter({ removeComments: true });
const normalize = value => value.replaceAll(/\s+/g, " ").trim();
function parse(file, text) { return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
function specialize(sf) {
  return ts.transform(sf, [(context) => {
    const visit = (node) => {
      if (sf.fileName === "server/backend/core/account/order_store.js") {
        if (ts.isExpressionStatement(node) && normalize(node.getText(sf)) === "preserveOrderMode(raw, prevRaw, o, existingByOrderId);")
          return undefined;
        if (ts.isIfStatement(node) && normalize(node.getText(sf)) === "if (rows.some(row => row.raw?.pmGtcExecutionId)) return saveRowsByExecution(rows);")
          return undefined;
      }
      if (ts.isExpressionStatement(node) && node.getText(sf).includes("orders = tagKnownGtcVenueOrders("))
        return undefined;
      if (ts.isIfStatement(node) && node.expression.getText(sf).startsWith("buyRow.PmGtcExecutionId"))
        return undefined;
      if (ts.isForOfStatement(node) && node.expression.getText(sf) === "gtcOrderProjection.rows")
        return undefined;
      if (ts.isCallExpression(node) && node.expression.getText(sf) === "saveRowsByExecution")
        return context.factory.createCallExpression(context.factory.createPropertyAccessExpression(context.factory.createIdentifier("sb"), "upsertOrders"), undefined, [node.arguments[0]]);
      if (ts.isSpreadAssignment(node) && node.expression.getText(sf).includes("raw.pmGtcExecutionId ?"))
        return undefined;
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
}
const results = [];
for (const file of ["client/web/src/api/order.ts", "client/web/src/stores/account/pmManualSell.ts", "server/backend/core/account/order_store.js", "server/backend/core/account/order/dto.js"]) {
  const previous = parse(file, execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }));
  const current = parse(file, fs.readFileSync(file, "utf8"));
  const transformed = specialize(current);
  if (file === "server/backend/core/account/order_store.js") {
    const print = (nodes, sf) => normalize(nodes.map(node => printer.printNode(ts.EmitHint.Unspecified, node, sf)).join("\n"));
    const oldImports = previous.statements.filter(ts.isImportDeclaration);
    const newImports = current.statements.filter(ts.isImportDeclaration);
    const extensions = newImports.filter(node => ["../orderModes/orderMetadata.js", "../orderModes/saveRows.js"].includes(node.moduleSpecifier.text));
    assert.equal(extensions.length, 2, "shared writer has exactly two mode extension imports");
    assert.equal(print(extensions, current), normalize('import { preserveOrderMode } from "../orderModes/orderMetadata.js"; import { saveRowsByExecution } from "../orderModes/saveRows.js";'));
    assert.equal(print(newImports.filter(node => !extensions.includes(node)), current), print(oldImports, previous), "all original shared writer imports are unchanged");
    assert.equal(print(transformed.transformed[0].statements.filter(node => !ts.isImportDeclaration(node)), current), print(previous.statements.filter(node => !ts.isImportDeclaration(node)), previous), "entire shared writer FOK specialization is unchanged");
  }
  const oldFunctions = previous.statements.filter(ts.isFunctionDeclaration);
  const newFunctions = transformed.transformed[0].statements.filter(ts.isFunctionDeclaration);
  for (const old of oldFunctions) {
    const next = newFunctions.find(fn => fn.name?.text === old.name?.text);
    assert(next, `${file}:${old.name.text} missing`);
    const before = normalize(printer.printNode(ts.EmitHint.Unspecified, old, previous));
    const after = normalize(printer.printNode(ts.EmitHint.Unspecified, next, current));
    assert.equal(after, before, `${file}:${old.name.text} FOK specialization`);
    results.push({ file, function: old.name.text, fokBodyIdentical: true });
  }
  transformed.dispose();
}
const store = "client/web/src/stores/orderStore.ts";
const oldStore = parse(store, execFileSync("git", ["show", `${base}:${store}`], { encoding: "utf8" }));
const newStore = parse(store, fs.readFileSync(store, "utf8"));
const printStore = sf => normalize(sf.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, sf)).join("\n"));
assert.equal(printStore(newStore), printStore(oldStore));
const result = { baseline: base, orderStoreBodyIdenticalWithInputDispatchAtImport: true, existingFunctionComparisons: results };
fs.writeFileSync("output/execution-refactor-shared-boundary-comparison.json", `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ baseline: base, orderStoreBodyIdentical: true, functionsIdenticalUnderFokInputs: results.length })}\n`);
