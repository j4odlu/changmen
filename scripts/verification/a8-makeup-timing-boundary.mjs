// [A8 可证实] 用户要求恢复检测后入队；仅还原删除的提前入队及撤销片段，固定 FOK 基线不变。
import assert from "node:assert/strict";
import ts from "typescript";

export const makeupTimingPreviousCommit = "a6b1a31386c8bc5d5c8df8770472b4e7b4e1ebcb";
const root = "client/web/src/stores/betting/autoBet/phases/";

/** 逐项恢复精确差异后，调用方仍比较整个模块与既有不可变基线，不豁免任何文件。 */
export function restoreA8MakeupTiming(file, source, replaceExact, readPrevious) {
  if (file === root + "placeArbLegs.ts" && source.includes("拒单检测结束后才由 finalize 决定入队")) {
    const previous = readPrevious(makeupTimingPreviousCommit, file);
    const tree = ts.createSourceFile(file, previous, ts.ScriptTarget.Latest, true);
    const blocks = [];
    const visit = node => {
      if (ts.isIfStatement(node) && node.expression.getText(tree) === "retry" && node.elseStatement)
        blocks.push(node.elseStatement.getText(tree));
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.equal(blocks.length, 1, "one immutable previous retry-failure block");
    source = replaceExact(source, '{ trace?.event("重试", "换腿未成功"); }', blocks[0]);
    source = replaceExact(source, "const { match, bet, config, trace } = params;", "const { match, bet, config, trace, setMessage } = params;");
    source = replaceExact(source, 'import { observeArbSubmissionBlocked } from "@/services/orderExecutionObservation";',
      'import { legStakeCny } from "@/domain/polymarket/pmArbStake"; import { observeArbSubmissionBlocked } from "@/services/orderExecutionObservation";');
    source = replaceExact(source, 'import { resolveArbLegPlaceOutcome } from "@/stores/betting/autoBet/phases/types";',
      'import { enqueueMakeUpOrder } from "@/stores/betting/autoBet/makeUp"; import { resolveArbLegPlaceOutcome } from "@/stores/betting/autoBet/phases/types";');
    return replaceExact(source, 'import { retryFailedLeg } from "@/stores/betting/autoBet/retryFailedLeg";',
      'import { retryFailedLeg } from "@/stores/betting/autoBet/retryFailedLeg"; import { useLoseOrderStore } from "@/stores/loseOrderStore";');
  }
  if (file === root + "finalizeArbBet.ts" && source.includes("首次拒单检测结束后统一决定补单入队，不再撤销提交阶段的提前队列")) {
    const previous = readPrevious(makeupTimingPreviousCommit, file);
    const tree = ts.createSourceFile(file, previous, ts.ScriptTarget.Latest, true);
    const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "cancelQueuedMakeUpForRejectedAnchor");
    assert.equal(functions.length, 1, "one immutable previous early-queue cancellation helper");
    source = replaceExact(source, 'import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";',
      'import { saveMakeUpCancelLog } from "@/services/bettingLog"; import { observeOrder } from "@/services/orderObservation"; import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";');
    source = replaceExact(source, 'import { useUserStore } from "@/stores/userStore";',
      'import { useLoseOrderStore } from "@/stores/loseOrderStore"; import { useUserStore } from "@/stores/userStore";');
    source = replaceExact(source, "export async function finalizeArbBet", functions[0].getText(tree) + "\nexport async function finalizeArbBet");
    source = replaceExact(source, "await placed.originalExecution?.close();", "await placed.originalExecution?.close(); cancelQueuedMakeUpForRejectedAnchor(params, placed, settle);");
    return source.replace("/** [A8 可证实] 首次拒单检测结束后统一决定补单入队，不再撤销提交阶段的提前队列。 */",
      "/** 套利收尾编排：settle → makeup → mark → notify（顺序对齐 A8 bundle） */");
  }
  return source;
}
