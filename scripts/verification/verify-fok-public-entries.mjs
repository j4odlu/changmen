import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// [changmen 扩展] Compare entire existing public modules, not just selected functions.
// The old source is captured from the running release; only explicit mode additions
// may be removed. All original imports and executable statements must remain.
const snapshot = JSON.parse(fs.readFileSync("output/vps-fok-baseline.json", "utf8"));
const printer = ts.createPrinter({ removeComments: true });
const normalize = text => text.replace(/\s+/g, " ").trim();
const results = [];
const files = [
  "server/backend/core/esport-api/account_client_routes.ts",
  "server/backend/core/esport-api/pm_pf_routes.ts",
  "server/backend/core/account/admin_orders.js",
  "client/web/src/shared/adminOrderDisplay.ts",
  "client/web/src/types/extensionPrefs.ts",
];
for (const file of files) {
  assert.equal(typeof snapshot.sources[file], "string", `Missing actual VPS source: ${file}`);
  const parse = text => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const previous = parse(snapshot.sources[file]);
  const current = parse(fs.readFileSync(file, "utf8"));
  let removedImports = 0;
  let removedBranches = 0;
  let replacedCalls = 0;
  let removedSpreads = 0;
  const transformed = ts.transform(current, [context => {
    const visit = node => {
      if (ts.isImportDeclaration(node)) {
        const target = node.moduleSpecifier.text;
        if ((file.endsWith("account_client_routes.ts") && target === "../orderModes/router.js")
          || (file.endsWith("pm_pf_routes.ts") && target === "../orderModes/gtc/handler.js")) {
          const expected = file.endsWith("account_client_routes.ts")
            ? 'import { getOrders, saveOrders } from "../orderModes/router.js";'
            : 'import { handlePmGtc } from "../orderModes/gtc/handler.js";';
          assert.equal(normalize(node.getText(current)), expected);
          removedImports++;
          return undefined;
        }
      }
      if (file.endsWith("account_client_routes.ts") && ts.isCallExpression(node)
        && ts.isIdentifier(node.expression) && ["getOrders", "saveOrders"].includes(node.expression.text)) {
        assert.equal(normalize(node.arguments.map(arg => arg.getText(current)).join(", ")), "body, ctx.user!.id");
        replacedCalls++;
        return context.factory.updateCallExpression(node,
          context.factory.createPropertyAccessExpression(context.factory.createIdentifier("accountService"),
            node.expression.text === "getOrders" ? "handleGetOrderList" : "handleSaveOrder"),
          node.typeArguments, node.arguments);
      }
      if (file.endsWith("pm_pf_routes.ts") && ts.isIfStatement(node)
        && normalize(node.expression.getText(current)) === '["Pm_GtcCreate", "Pm_GtcCommand", "Pm_GtcList", "Pm_GtcOrders", "Pm_GtcSaveOrders"].includes(action)') {
        assert(!node.elseStatement, "GTC action extension cannot change the existing fallback");
        removedBranches++;
        return undefined;
      }
      if (ts.isSpreadAssignment(node)) {
        const addition = normalize(node.getText(current));
        const allowed = file.endsWith("admin_orders.js")
          ? ['...(o.PmGtcExecutionId ? { pmGtcExecutionId: o.PmGtcExecutionId, pmGtcBuyShares: o.PmGtcBuyShares } : {})']
          : file.endsWith("adminOrderDisplay.ts")
            ? ['...(row.pmGtcExecutionId ? { PmGtcExecutionId: row.pmGtcExecutionId, PmGtcBuyShares: row.pmGtcBuyShares } : {})']
            : file.endsWith("extensionPrefs.ts") ? [
                '...(typeof row.pmGtcV1Activation === "string" ? { pmGtcV1Activation: row.pmGtcV1Activation } : {})',
                '...(row.pmGtcV1Participant === true ? { pmGtcV1Participant: true } : {})',
              ] : [];
        if (allowed.includes(addition)) {
          removedSpreads++;
          return undefined;
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit);
  }]);
  const specialized = transformed.transformed[0];
  const imports = sf => sf.statements.filter(ts.isImportDeclaration)
    .map(node => normalize(printer.printNode(ts.EmitHint.Unspecified, node, sf))).sort();
  assert.deepEqual(imports(specialized), imports(previous), `${file}: original imports`);
  const body = sf => {
    const text = sf.statements.filter(node => !ts.isImportDeclaration(node))
      .map(node => printer.printNode(ts.EmitHint.Unspecified, node, sf)).join("\n");
    return normalize(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, removeComments: true } }).outputText);
  };
  assert.equal(body(specialized), body(previous), `${file}: complete existing executable module`);
  const expected = file.endsWith("account_client_routes.ts") ? [1, 0, 2, 0]
    : file.endsWith("pm_pf_routes.ts") ? [1, 1, 0, 0]
      : file.endsWith("extensionPrefs.ts") ? [0, 0, 0, 2] : [0, 0, 0, 1];
  assert.deepEqual([removedImports, removedBranches, replacedCalls, removedSpreads], expected, `${file}: bounded mode additions`);
  transformed.dispose();
  results.push({ file, originalImportsIdentical: true, completeExistingModuleIdentical: true });
}
const report = { checkedAt: new Date().toISOString(), version: snapshot.version, passed: true, results };
fs.writeFileSync("output/fok-public-entry-comparison.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
