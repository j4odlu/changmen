import { computed, onMounted, ref } from "vue";
import type { OrderRow } from "@/types/order";
import type { OrderListSource } from "../orderListTypes";
import { pfOrderMatchText, pfOrderBetText, pfOrderItemText } from "@/shared/pfOrderDisplay";
import { ensurePfOrderLabelIndex } from "@/shared/pfOrderLabelIndex";
import { positionEventObserveTag } from "@/shared/positionEventsDisplay";

export function useOrderListLabels(props: OrderListSource) {
  const pfLabelTick = ref(0);
  onMounted(() => {
    void ensurePfOrderLabelIndex().then((ok) => {
      if (ok)
        pfLabelTick.value += 1;
    });
  });

  function pfMatchText(row: OrderRow): string {
    void pfLabelTick.value;
    return pfOrderMatchText(row);
  }

  function pfBetText(row: OrderRow): string {
    void pfLabelTick.value;
    return pfOrderBetText(row);
  }

  function pfItemText(row: OrderRow): string {
    void pfLabelTick.value;
    return pfOrderItemText(row);
  }

  /** 双写观察：peers 缓存，避免每行 O(n) 重建 */
  const pePeerRows = computed(() => {
    const peers: OrderRow[] = [];
    for (const [, rows] of props.orderEntries)
      peers.push(...rows);
    return peers;
  });

  function peObserveTag(row: OrderRow) {
    return positionEventObserveTag(row, pePeerRows.value);
  }


  return { pfMatchText, pfBetText, pfItemText, peObserveTag };
}
