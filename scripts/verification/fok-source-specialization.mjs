import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import ts from "typescript";
import { readRelocatedPmFokSource } from "./pm-fok-source-relocation.mjs";
import { readRelocatedPmFunctionalSource } from "./pm-functional-source-relocation.mjs";
import { replaceExact } from "./fok-exact-boundaries.mjs";
import { restorePublishedPmSettlement } from "./pm-published-settlement-boundary.mjs";
import { restorePmManualSellSplit } from "./pm-manual-sell-split-boundary.mjs";
import { restorePmOrderBetLabelSource } from "./pm-order-bet-label-boundary.mjs";
import { restorePmTickRefreshSource } from "./pm-tick-refresh-boundary.mjs";
import { restorePmPreflightSource } from "./pm-preflight-boundary.mjs";
import { restorePmUnifiedPreflightSource } from "./pm-unified-preflight-boundary.mjs";

// [changmen 扩展] 业务特化只识别两个完整隔离边界；登记的 PM 移动模块恢复路径后仍全文比较，固定基线不变。
export function specializeFokSource(file, source, readSource) {
  source = restorePmUnifiedPreflightSource(file, source);
  const readActual = readSource ?? (path => readAdapterHistory(path, 'utf8'));
  const readPublished = target => restorePublishedPmSettlement(target, restorePmOrderBetLabelSource(target, restorePmPreflightSource(target, readActual(target)), readActual));
  const text = restorePmTickRefreshSource(file, restorePmManualSellSplit(file, readRelocatedPmFokSource(file, readRelocatedPmFunctionalSource(file, restorePublishedPmSettlement(file, source), readPublished), readPublished)));
  function removeOnce(value, fragment) {
    assert.equal(value.split(fragment).length, 2, `${file}: expected exactly one known extension`);
    return value.replace(fragment, "");
  }
  if (file === "client/web/src/shared/orderLink.ts") {
    const marker = "export function isRebindableOrderRow(row: OrderRow): boolean {\n";
    assert(text.includes(`${marker}  if (row.DisplayOnly)\n    return false;\n`), "DisplayOnly guard must be at the rebind entry");
    return removeOnce(text, "  if (row.DisplayOnly)\n    return false;\n");
  }
  if (file === "client/web/src/stores/account/pmManualSell.ts") {
    // [changmen 扩展] 只恢复已上线的三个完整增量；不引入本地私有 helper 重构。
    let restored = replaceExact(text, `const persist = async () => {
      if (buyRow.PmGtcExecutionId) {
        const { saveOrders: saveGtcOrders } = await import("@/orderModes/gtc/ordersApi");
        await saveGtcOrders(account, ordersToSave.map(row => ({ ...row, pmGtcExecutionId: buyRow.PmGtcExecutionId })));
      }
      else {
        await saveOrders(account, ordersToSave);
      }
    };`);
    restored = replaceExact(restored, `const reason = saveErr instanceof Error ? saveErr.message : String(saveErr);
      if (buyRow.PmGtcExecutionId) {
        ElMessage.warning(\`卖单已返回成交，成交确认、净回款核对或订单保存尚未完成：\${reason}。已保留原卖单并自动重试，请勿重复卖出。\`);
      }
      else {
        ElMessage.error(\`链上已平仓，但订单落库失败：\${reason}。已按已平仓展示，请稍后刷新。\`);
      }`, `ElMessage.error(
        \`链上已平仓，但订单落库失败：\${saveErr instanceof Error ? saveErr.message : String(saveErr)}。已按已平仓展示，请稍后刷新。\`,
      );`);
    assert.equal(restored.split("await persist();").length, 3, "exactly two original persistence call sites");
    return restored.replaceAll("await persist();", "await saveOrders(account, ordersToSave);");
  }
  return text;
}
