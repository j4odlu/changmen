// [changmen 扩展] 登记 2391dc9d 的两段 RAY 原单监控扩展；完整校验后恢复固定 FOK 模块。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import ts from "typescript";

export const rayMonitorReviewedCommit = "2391dc9df446dcb7ed85030a3faca3696b0d0da7";
const patchDigest = "0dfdb8b91d8c5cfd6fff766800ec176b10a3055ed4e23b6da025d293df26adb8";
const recoveryDigest = "a746266ab02a915665db397fbd7f630c8658f039c4e152c35cc3729be0d51f86";
const printer = ts.createPrinter({ removeComments: true });

export function restoreRayOrderMonitorSource(source) {
  const text = source.replaceAll("\r\n", "\n");
  const file = ts.createSourceFile("orders_store.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, "RAY monitoring boundary must parse");
  const functions = name => file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const patches = functions("patchRayMonitorOrders");
  const readers = functions("fetchOrdersByPlayerStrict");
  assert.equal(patches.length, 1, "exactly one reviewed RAY monitoring writer");
  assert.equal(readers.length, 1, "exactly one original strict reader");
  const branches = readers[0].body.statements.filter(node => ts.isIfStatement(node) && node.expression.getText(file).includes("rayMonitorOrderIds"));
  assert.equal(branches.length, 1, "exactly one reviewed RAY monitoring recovery branch");
  for (const [node, expected, label] of [[patches[0], patchDigest, "writer"], [branches[0], recoveryDigest, "recovery"]]) {
    const canonical = printer.printNode(ts.EmitHint.Unspecified, node, file);
    assert.equal(createHash("sha256").update(canonical).digest("hex"), expected, `complete reviewed RAY monitoring ${label}`);
  }
  // 仅删除两个已完整校验的 AST 范围；其他分支、调用和订单模块仍参与全文固定基线比较。
  let restored = text;
  for (const node of [patches[0], branches[0]].sort((a, b) => b.getStart(file) - a.getStart(file)))
    restored = restored.slice(0, node.getStart(file)) + restored.slice(node.getEnd());
  return restored;
}
