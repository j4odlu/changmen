import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";
import { adminOrderDialogGroups, adminOrderComputedNames, executableAdminOrderSource, originalAdminOrderDialog, originalAdminOrderScript } from "./__tests__/adminOrderDialogOriginal";

const read = (file: string) => readFileSync(resolve(process.cwd(), "src/components/admin", file), "utf8").replaceAll("\r\n", "\n");
const parse = (source: string) => ts.createSourceFile("dialog.ts", source, ts.ScriptTarget.Latest, true);
const oldTree = parse(originalAdminOrderScript);
const oldFunctions = new Map(oldTree.statements.filter(ts.isFunctionDeclaration).map(node => [node.name!.text, node.getText(oldTree)]));
function declarations(source: string) {
  const tree = parse(source), values = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) values.set(node.name.getText(tree), node.getText(tree));
    ts.forEachChild(node, visit);
  };
  visit(tree); return values;
}

test("preserves all 25 extracted function bodies including grouping ties, money and labels", () => {
  let count = 0;
  for (const [file, names] of Object.entries(adminOrderDialogGroups)) {
    const tree = parse(read(file + ".ts")), functions = new Map<string, string>();
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree));
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const name of names) {
      expect(executableAdminOrderSource(functions.get(name)!), name).toBe(executableAdminOrderSource(oldFunctions.get(name)!));
      count++;
    }
  }
  expect(count).toBe(25);
});

test("preserves all 20 computed bodies and both formatting/grouping constants", () => {
  const before = declarations(originalAdminOrderScript);
  const presentation = declarations(read("useAdminOrderLogPresentation.ts"));
  for (const name of adminOrderComputedNames)
    expect(executableAdminOrderSource(presentation.get(name)!.replaceAll("readExecutionLookup()", "executionLookup.value")), name)
      .toBe(executableAdminOrderSource(before.get(name)!));
  for (const [file, name] of [["adminOrderLogGrouping", "ARB_LINK_MIN"]])
    expect(executableAdminOrderSource(declarations(read(file + ".ts")).get(name)!)).toBe(executableAdminOrderSource(before.get(name)!));
});

test("keeps every request/copy/close handler, state initializer, public API, template and style unchanged", () => {
  const next = read("AdminOrderLogsDialog.vue"), script = next.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1];
  const moved = new Set(Object.values(adminOrderDialogGroups).flat());
  const handlers = parse(script).statements.filter(ts.isFunctionDeclaration);
  expect(handlers.map(node => node.name!.text).sort()).toEqual([...oldFunctions.keys()].filter(name => !moved.has(name)).sort());
  const nextTree = parse(script);
  for (const handler of handlers)
    expect(executableAdminOrderSource(handler.getText(nextTree)), handler.name!.text).toBe(executableAdminOrderSource(oldFunctions.get(handler.name!.text)!));
  const before = declarations(originalAdminOrderScript), after = declarations(script);
  for (const name of ["visible", "loading", "error", "data", "title", "requestSequence", "lookupRows", "expanded", "legacyDetailed", "executionLookup", "kindLabel"])
    expect(executableAdminOrderSource(after.get(name)!), name).toBe(executableAdminOrderSource(before.get(name)!));
  expect(script).toContain("defineExpose({ open, openExecution });");
  expect(next.slice(next.indexOf("</script>"))).toBe(originalAdminOrderDialog.slice(originalAdminOrderDialog.indexOf("</script>")));
});
