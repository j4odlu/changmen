import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { restorePmPreflightSource } from "./pm-preflight-boundary.mjs";

// [changmen 扩展] 只允许这四个原模块迁入 PM/fok；比较时恢复原相对 import，完整实现仍与固定基线比较。
const root = "packages/venue-adapter/polymarket";
export const PM_FOK_RELOCATIONS = Object.freeze(Object.fromEntries(
  ["bet.ts", "orderSettlement.ts", "settlementJob.ts", "pmFokDepthBufferMode.ts"]
    .map(name => [`${root}/${name}`, `${root}/fok/${name}`]),
));

export function pmFokCompatibilitySource(file) {
  const target = PM_FOK_RELOCATIONS[file];
  assert(target, `No PM FOK relocation registered: ${file}`);
  return `// [changmen 扩展] 保留原入口；FOK 实现迁入 fok，所有调用共享同一模块与状态。\nexport * from "./fok/${path.posix.basename(target, ".ts")}";\n`;
}

// 仅改变模块路径字面量；保留其它源码、注释、顺序、引号和所有执行语句。
export function rebasePmFokImports(source, fromFile, toFile) {
  const sf = ts.createSourceFile(fromFile, source, ts.ScriptTarget.Latest, true);
  assert.equal(sf.parseDiagnostics.length, 0, `${fromFile}: invalid TypeScript`);
  const edits = [];
  function visit(node) {
    if (ts.isStringLiteral(node) && node.text.startsWith(".")) {
      const parent = node.parent;
      const modulePath = ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node)
        || (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword && parent.arguments[0] === node)
        || (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent));
      if (modulePath) {
        const target = path.posix.resolve(path.posix.dirname(fromFile), node.text);
        let relative = path.posix.relative(path.posix.resolve(path.posix.dirname(toFile)), target);
        // [changmen 扩展] 目录与原文件同名时，不能用 ./ 或 ../ 指代原文件；明确保留模块名。
        if (!relative || relative.split("/").every(part => part === "." || part === "..")) {
          relative = `${path.posix.relative(path.posix.resolve(path.posix.dirname(toFile)), path.posix.dirname(target))}/${path.posix.basename(target)}`;
        }
        if (!relative.startsWith("."))
          relative = `./${relative}`;
        const start = node.getStart(sf) + 1;
        const end = node.getEnd() - 1;
        assert.equal(source.slice(start, end), node.text, `${fromFile}: escaped module paths are not a relocation`);
        edits.push({ start, end, relative });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.relative + source.slice(edit.end);
  return source;
}

export function readRelocatedPmFokSource(file, source, readSource = target => fs.readFileSync(target, "utf8")) {
  const target = PM_FOK_RELOCATIONS[file];
  if (!target)
    return source.replace(/\r\n/g, "\n");
  assert.equal(source.replace(/\r\n/g, "\n"), pmFokCompatibilitySource(file), `${file}: compatibility entry must only re-export the registered FOK module`);
  return rebasePmFokImports(restorePmPreflightSource(target, readSource(target)), target, file).replace(/\r\n/g, "\n");
}
