import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 仅登记原单核验收尾的并发修复；所有既有 FOK 基线及增量保持固定。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';

const registered = readAdapterHistory(new URL("./pm-makeup-settlement-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(registered).digest("hex"), "968a6d4b9fa4e6136081d2a6b3218263e2947b62d9c3af7ba777feabe73c9b86", "PM makeup settlement corrections must remain fixed");
export const pmMakeupSettlementIncrements = JSON.parse(registered);

// [changmen 扩展] 后续完成性修复逐项叠加；不替换上述已固定增量或原 FOK 基线。
const completionRegistered = readAdapterHistory(new URL("./pm-makeup-completion-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(completionRegistered).digest("hex"), "7e7ea114b67f012382a7182ac26f5e83a07acbdcc2032cd8a70a456a8b19654e", "PM makeup completion corrections must remain fixed");
export const pmMakeupCompletionIncrements = JSON.parse(completionRegistered);

// [changmen 扩展] 单笔即时保存与原单计数修复；逐项精确登记，不豁免完整模块检查。
const lifecycleRegistered = readAdapterHistory(new URL("./pm-makeup-lifecycle-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(lifecycleRegistered).digest("hex"), "2c471e0d6807ab6f9e40bdce63cdbe9886b13e26d2037d8cfa83fe1365cd9c8f", "PM makeup lifecycle corrections must remain fixed");
export const pmMakeupLifecycleIncrements = JSON.parse(lifecycleRegistered);

// [changmen 扩展] 普通馆已受理原单恢复与 A8 收尾顺序；旧增量与两个固定基线保持不变。
const receiptRegistered = readAdapterHistory(new URL("./a8-makeup-receipt-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(receiptRegistered).digest("hex"), "8ff8a3128feeb845904e4241b540dcbecdec46cbaf57f5cf51ab17d14a3a7f32", "A8 makeup receipt corrections must remain fixed");
export const a8MakeupReceiptIncrements = JSON.parse(receiptRegistered);

// [changmen 扩展] 原单查询异常的统一续查；保留前述所有已固定修正及原 FOK 基线。
const queryRecoveryRegistered = readAdapterHistory(new URL("./makeup-query-recovery-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(queryRecoveryRegistered).digest("hex"), "cf29adba3bd40b759f95a1ce4b637ee42855d23b3d71ce9da55d717c6d058050", "Makeup query recovery corrections must remain fixed");
export const makeupQueryRecoveryIncrements = JSON.parse(queryRecoveryRegistered);

// [changmen 扩展] 确认型原单先保存终态再收尾；不替换既有增量或任何固定 FOK 基线。
const terminalRegistered = readAdapterHistory(new URL("./pm-makeup-terminal-increments.json", import.meta.url), "utf8").replaceAll("\r\n", "\n");
assert.equal(createHash("sha256").update(terminalRegistered).digest("hex"), "95432891ba31f241a744022cda089c09be2937ee51b5b68c4546de0694210f3e", "Makeup terminal receipt corrections must remain fixed");
export const pmMakeupTerminalIncrements = JSON.parse(terminalRegistered);

export function restorePmMakeupSettlementSource(file, source, replaceExact) {
  const terminal = pmMakeupTerminalIncrements[file];
  if (terminal && source.includes(terminal.marker)) {
    for (const [current, original] of terminal.changes)
      source = replaceExact(source, current, original);
  }
  const recovery = makeupQueryRecoveryIncrements[file];
  if (recovery && source.includes(recovery.marker)) {
    for (const [current, original] of recovery.changes)
      source = replaceExact(source, current, original);
  }
  const receipt = a8MakeupReceiptIncrements[file];
  if (receipt && source.includes(receipt.marker)) {
    for (const [current, original] of receipt.changes)
      source = replaceExact(source, current, original);
  }
  const lifecycle = pmMakeupLifecycleIncrements[file];
  if (lifecycle && source.includes(lifecycle.marker)) {
    for (const [current, original] of lifecycle.changes)
      source = replaceExact(source, current, original);
  }
  const completion = pmMakeupCompletionIncrements[file];
  if (completion && source.includes(completion.marker)) {
    for (const [current, original] of completion.changes)
      source = replaceExact(source, current, original);
  }
  const entry = pmMakeupSettlementIncrements[file];
  if (!entry || !source.includes(entry.marker))
    return source;
  for (const [current, original] of entry.changes)
    source = replaceExact(source, current, original);
  return source;
}
