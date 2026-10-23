import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { accountEditGroups, executableAccountSource, originalAccountDialog, originalAccountFunctions, originalAccountScript } from "./__tests__/accountEditOriginal";

const read = (file: string) => readFileSync(join(process.cwd(), "src/components/account", file), "utf8").replaceAll("\r\n", "\n");
const tree = (source: string) => ts.createSourceFile("account.ts", source, ts.ScriptTarget.Latest, true);
const undoAccess = (source: string) => source.replaceAll("ctx.form", "form");
const undoCancel = (source: string) => source.replaceAll("polymarketEditor.cancelPending();",
  "polyAsyncOpSeq += 1; polyGenerating.value = false; polyDerivingAddresses.value = false;");

it("preserves all 37 extracted function bodies including validation, DTOs, await order and error handling", () => {
  let count = 0;
  for (const [module, names] of Object.entries(accountEditGroups)) {
    const ast = tree(read(module + ".ts")), functions = new Map<string, string>();
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
      ts.forEachChild(node, visit);
    };
    visit(ast);
    for (const name of names) {
      expect(executableAccountSource(undoAccess(functions.get(name)!)), name)
        .toBe(executableAccountSource(originalAccountFunctions.get(name)!));
      count++;
    }
  }
  expect(count).toBe(37);
});

it("preserves every wallet/OB state initializer and keeps counters within each editor instance", () => {
  const old = tree(originalAccountScript);
  for (const [module, prefix] of [["polymarketAccountEditor", "poly"], ["predictFunAccountEditor", "pf"], ["obSportAccountEditor", "sportObForm"]]) {
    const nodes = old.statements.filter(ts.isVariableStatement).filter(n =>
      n.declarationList.declarations.some(d => d.name.getText(old).startsWith(prefix)));
    const next = tree(read(module + ".ts"));
    const factory = next.statements.find(ts.isFunctionDeclaration)!;
    const variables = factory.body!.statements.filter(ts.isVariableStatement);
    for (const node of nodes) {
      const name = node.declarationList.declarations[0]!.name.getText(old);
      const moved = variables.find(n => n.declarationList.declarations[0]?.name.getText(next) === name)!;
      expect(executableAccountSource(moved.getText(next)), name).toBe(executableAccountSource(node.getText(old)));
    }
  }
});

it("preserves remaining handlers, all four watcher positions/options, prop schema and the entire template/styles", () => {
  const dialog = read("AccountEditDialog.vue"), script = dialog.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1];
  const next = tree(script), moved = new Set<string>(Object.values(accountEditGroups).flat());
  const functions = next.statements.filter(ts.isFunctionDeclaration);
  expect(functions.map(n => n.name!.text).sort()).toEqual([...originalAccountFunctions.keys()].filter(n => !moved.has(n)).sort());
  for (const node of functions)
    expect(executableAccountSource(undoCancel(node.getText(next))), node.name!.text)
      .toBe(executableAccountSource(originalAccountFunctions.get(node.name!.text)!));
  const watchers = (source: string) => {
    const ast = tree(source);
    return ast.statements.filter(ts.isExpressionStatement).map(n => n.getText(ast)).filter(s => s.startsWith("watch("))
      .map(s => executableAccountSource(undoCancel(s)));
  };
  expect(watchers(script)).toEqual(watchers(originalAccountScript));
  expect(dialog.slice(dialog.indexOf("</script>"))).toBe(originalAccountDialog.slice(originalAccountDialog.indexOf("</script>")));
  const schema = originalAccountScript.match(/const props = defineProps<([\s\S]*?)>\(\);/)![1];
  const nextSchema = read("accountEditContext.ts").match(/export interface AccountEditDialogProps ([\s\S]*?)\n\nexport interface/)![1];
  const printSchema = (source: string) => {
    const ast = tree("type Props = " + source);
    return ts.createPrinter({ removeComments: true }).printFile(ast);
  };
  expect(printSchema(nextSchema)).toBe(printSchema(schema));
  expect(script).toContain("get form() { return form; }");
});
