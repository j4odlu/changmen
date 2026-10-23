import { expect, test } from "vitest";
import ts from "typescript";
import { obAst, obFootballGroups, originalObFootball, readObRuntime } from "./__tests__/obFootballOriginal";

const functionNodes = (source: string) => new Map(obAst(source).statements.filter(ts.isFunctionDeclaration).map(n => [n.name!.text, n]));
const executable = (source: string) => ts.transpileModule(source.replace(/^export /m, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true },
}).outputText.trim();
const old = functionNodes(originalObFootball);
for (const [module, names] of Object.entries(obFootballGroups)) {
  test.each(names)(`${module}: %s preserves its complete executable implementation`, name => {
    let before = old.get(name)!.getText();
    if (name === "clampLiveStart") before = before.replace("now = Date.now()", "now: number");
    if (name === "buildDto") before = before
      .replace("oddsRow: Record<string, unknown> | null | undefined)", "oddsRow: Record<string, unknown> | null | undefined, readNow: () => number)")
      .replace("meta.isLive,\n  );", "meta.isLive,\n    readNow(),\n  );")
      .replace("startTime || Date.now()", "startTime || readNow()");
    expect(executable(functionNodes(readObRuntime(module)).get(name)!.getText())).toBe(executable(before));
  });
}
const moved = new Set(Object.values(obFootballGroups).flat());
test.each([...old.keys()].filter(name => !moved.has(name)))("HTTP/cache/session orchestration %s stays unchanged", name => {
  expect(executable(functionNodes(readObRuntime("obSportFootballFetch")).get(name)!.getText()))
    .toBe(executable(old.get(name)!.getText()));
});
test("preserves public types, exported names, all configuration and cache initializers", () => {
  const main = obAst(readObRuntime("obSportFootballFetch")), response = obAst(readObRuntime("obSportFootballResponse"));
  const exports = (tree: ts.SourceFile) => tree.statements.flatMap(n => ts.isExportDeclaration(n)
    && n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements.map(e => e.name.text)
    : (ts.isFunctionDeclaration(n) || ts.isTypeAliasDeclaration(n)) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? [n.name!.text] : []).sort();
  expect(exports(main)).toEqual(exports(obAst(originalObFootball)));
  const types = (tree: ts.SourceFile) => tree.statements.filter(ts.isTypeAliasDeclaration).map(n => n.getText().replace(/^export /, "")).sort();
  expect(types(response)).toEqual(types(obAst(originalObFootball)));
  const declarations = (trees: ts.SourceFile[]) => trees.flatMap(tree => tree.statements.filter(ts.isVariableStatement)
    .flatMap(n => n.declarationList.declarations.map(d => d.getText()))).sort();
  expect(declarations([main, response])).toEqual(declarations([obAst(originalObFootball)]));
  expect(functionNodes(readObRuntime("obSportFootballFetch")).get("buildDto")!.body!.getText())
    .toContain("buildObFootballDto(meta, oddsRow, () => Date.now())");
});
test("extracted transformations do not read ambient clocks, HTTP, sessions or browser storage", () => {
  for (const module of Object.keys(obFootballGroups)) {
    const source = readObRuntime(module);
    expect(source).not.toMatch(/Date\.now|a8Axios|sessionStorage|localStorage|readLocalSportObSession|rememberOb|setTimeout|fetch\(/);
  }
});
