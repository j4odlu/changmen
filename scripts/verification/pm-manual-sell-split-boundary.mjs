// [changmen 扩展] 完整证明私有 GTC 保存拆分：普通函数等于原 FOK，GTC 函数等于已提交实现，模块无额外动作。
import assert from "node:assert/strict";
import ts from "typescript";
import { gitSource, moduleTokens, replaceExact } from "./fok-exact-boundaries.mjs";

const file = "client/web/src/stores/account/pmManualSell.ts";
const committed = "3465fe5d";
function parse(text) {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  assert.equal(tree.parseDiagnostics.length, 0, "manual sell split must parse");
  const fn = (name) => {
    const nodes = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.equal(nodes.length, 1, `one complete manual sell function: ${name}`);
    return nodes[0];
  };
  return { tree, fn };
}
export function restorePmManualSellSplit(target, source) {
  if (target !== file || !source.includes("function persistGtcFilledSell("))
    return source;
  const { tree, fn } = parse(source);
  const wrapper = fn("persistFilledSell");
  const helper = fn("persistGtcFilledSell");
  const gate = wrapper.body.statements[0];
  assert.equal(gate.getText(tree).replace(/\s+/g, " "), "if (buyRow.PmGtcExecutionId) return persistGtcFilledSell(account, buyRow, ordersToSave);", "first statement is the exact identity dispatch");
  const ordinary = wrapper.getText(tree);
  const plain = replaceExact(ordinary, "if (buyRow.PmGtcExecutionId) return persistGtcFilledSell(account, buyRow, ordersToSave);");
  const baseline = gitSource("219535c8", file);
  const oldPlain = parse(baseline);
  assert.deepEqual(moduleTokens(plain), moduleTokens(oldPlain.fn("persistFilledSell").getText(oldPlain.tree)), "complete ordinary FOK persistence body");
  const fixed = gitSource(committed, file);
  const oldMixed = parse(fixed);
  const renamed = replaceExact(helper.getText(tree), "async function persistGtcFilledSell(", "async function persistFilledSell(");
  const original = oldMixed.fn("persistFilledSell").getText(oldMixed.tree);
  assert.deepEqual(moduleTokens(renamed), moduleTokens(original), "complete committed GTC persistence body");
  const ranges = [
    { start: helper.getStart(tree), end: helper.getEnd(), text: "" },
    { start: wrapper.getStart(tree), end: wrapper.getEnd(), text: original },
  ].sort((a, b) => b.start - a.start);
  let restored = source;
  for (const range of ranges) restored = restored.slice(0, range.start) + range.text + restored.slice(range.end);
  assert.deepEqual(moduleTokens(restored), moduleTokens(fixed), "complete committed manual sell module after the exact private split");
  return fixed;
}

export function restoreGtcSnapshotMetadata(source) {
  if (!source.includes("pmGtcOrderSnapshot"))
    return source;
  let restored = replaceExact(source, "[\"pmGtcExecutionId\", \"pmGtcRevision\", \"pmGtcBuyShares\", \"pmGtcBuyCost\", \"pmGtcOrderSnapshot\"]", "[\"pmGtcExecutionId\", \"pmGtcRevision\", \"pmGtcBuyShares\", \"pmGtcBuyCost\"]");
  restored = replaceExact(restored, "[\"pmGtcRevision\", \"pmGtcBuyShares\", \"pmGtcBuyCost\", \"pmGtcOrderSnapshot\"]", "[\"pmGtcRevision\", \"pmGtcBuyShares\", \"pmGtcBuyCost\"]");
  return restored;
}
