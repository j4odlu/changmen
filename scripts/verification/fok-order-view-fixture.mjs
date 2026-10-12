// [changmen 扩展] 仅审查已存在的可选显示入口；不接入或放宽原严格发布保护。
import assert from "node:assert/strict";

export function checkOrdinaryOrderView(current, original) {
  let source = current.replace(/\r\n/g, "\n");
  function remove(statement) {
    assert.equal(source.split(statement).length - 1, 1, `exact OrderView extension: ${statement}`);
    source = source.replace(statement, "");
  }
  remove("import type { OrderListEntry } from \"@/components/order/OrderList.vue\";\n");
  remove("    /** [changmen 扩展] 可选的只读显示投影；缺省沿用普通订单与补单列表。 */\n    projectOrderEntries?: (entries: ReadonlyArray<OrderListEntry>) => ReadonlyArray<OrderListEntry>;\n");
  remove("const displayOrderEntries = computed(() => props.projectOrderEntries?.(mergedOrderEntries.value) ?? mergedOrderEntries.value);\n");
  remove("      <template v-if=\"$slots['buy-amount']\" #buy-amount=\"{ row }\">\n        <slot name=\"buy-amount\" :row=\"row\" />\n      </template>\n");
  remove("      <template v-if=\"$slots['row-actions']\" #row-actions=\"{ row, link, rows }\">\n        <slot name=\"row-actions\" :row=\"row\" :link=\"link\" :rows=\"rows\" />\n      </template>\n");
  assert.equal(source.split("displayOrderEntries").length - 1, 3, "exact three display references");
  source = source.replaceAll("displayOrderEntries", "mergedOrderEntries");
  assert.equal(source, original.replace(/\r\n/g, "\n"), "complete ordinary OrderView module");
  return { optionalProjectionAndAmountSlotOnly: true, completeOrdinaryModuleEqual: true };
}
