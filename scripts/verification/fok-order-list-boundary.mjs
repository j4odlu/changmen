// [changmen 扩展] 完整保护已有 DisplayOnly 展示、操作边界及可选执行详情。
import assert from "node:assert/strict";

export function checkOrdinaryOrderList(current, baseline) {
  let source = current.replace(/\r\n/g, "\n");
  function replace(before, after = "") {
    assert.equal(source.split(before).length, 2, `exact OrderList boundary: ${before}`);
    source = source.replace(before, after);
  }
  replace("import OrderModeDetails from \"@/orderModes/OrderDetails.vue\";\n");
  replace("          <OrderModeDetails v-if=\"block.row.PmGtcExecutionId && !$slots['row-actions']\" :row=\"block.row\" :readonly=\"!allowPmSell && !allowPfSell\" />\n");
  replace("<slot name=\"buy-amount\" :row=\"block.row\">{{ toFixed(pmOrderStakeDisplayCny(block.row), 0) }}</slot>", "{{ toFixed(pmOrderStakeDisplayCny(block.row), 0) }}");
  replace("function showPmSellButton(row: OrderRow): boolean {\n  return props.allowPmSell && !row.DisplayOnly && canManualSellPmBuy(row);\n}", "function showPmSellButton(row: OrderRow): boolean {\n  return props.allowPmSell && canManualSellPmBuy(row);\n}");
  replace("function pmLiveUnrealizedPnlCny(row: OrderRow): number | null {\n  if (row.DisplayOnly && row.BetMoney == null)\n    return null;\n  return pmUnrealizedPnlAtLiveCny(row, pmLiveClobPrice(row));\n}", "function pmLiveUnrealizedPnlCny(row: OrderRow): number | null {\n  return pmUnrealizedPnlAtLiveCny(row, pmLiveClobPrice(row));\n}");
  replace("async function onPmSell(row: OrderRow) {\n  if (row.DisplayOnly)\n    return;\n  await confirmAndSellPmBuyOrder(row);\n}", "async function onPmSell(row: OrderRow) {\n  await confirmAndSellPmBuyOrder(row);\n}");
  assert.equal(source, baseline.replace(/\r\n/g, "\n"), "complete ordinary OrderList module");
  return { completeOrdinaryModuleEqual: true, displayOnlyGuardsAndOptionalDetailsVerified: true };
}
