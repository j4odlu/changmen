<script setup lang="ts">
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import { toFixed } from "@changmen/client-core/shared/format";
import { computed, watch } from "vue";
import OrderList from "@/components/order/OrderList.vue";
import { pmOrderStakeDisplayCny } from "@/shared/pmOrderDisplay";
import { compareOrderLinkDesc } from "@/shared/orderLink";
import { useOrderStore } from "@/stores/orderStore";
import { gtcProgress } from "./gtcProgressState";
import { gtcOrderDisplayGroups } from "./orderDisplayProjection";
import ProgressPanel from "./ProgressPanel.vue";

const props = defineProps<{ date: string; accountId: number; records?: GtcExecution[]; error?: string; kind?: "zero" | "other" }>();
const emit = defineEmits<{ hasOrders: [value: boolean] }>();
const orders = useOrderStore();
const displayError = computed(() => props.error ?? gtcProgress.error);
// Only originals absent from the ordinary order list may render a temporary progress card.
const groups = computed(() => {
  const rows = gtcOrderDisplayGroups([...orders.orders.values()].flat(), props.records ?? gtcProgress.records, props.date, props.accountId)
    .filter(group => group.pending && (!props.accountId || group.pending.PlayerID === props.accountId)
      && (!props.kind || (props.kind === "zero") === (group.execution?.submit === "accepted" && Number(group.execution.matched) === 0)));
  // [changmen 扩展] 零成交区按普通 Link 时间排序；不更改财务列表的集合或排序。
  return props.kind === "zero" ? rows.sort((a, b) => compareOrderLinkDesc(a.pending!, b.pending!)) : rows;
});
watch(() => groups.value.length > 0, value => emit("hasOrders", value), { immediate: true });
function hasRuntimeRecord(execution: GtcExecution) {
  return gtcProgress.owner === execution.owner && gtcProgress.records.some(row => row.id === execution.id
    && row.owner === execution.owner && row.revision >= execution.revision);
}
</script>

<template>
  <section v-if="groups.length || displayError" :aria-label="kind === 'zero' ? '零成交 GTC 订单' : '尚未入库的 GTC 挂单'">
    <p v-if="displayError" role="status">
      订单核对暂不可用：{{ displayError }}
    </p>
    <OrderList v-for="group in groups" :key="group.id" :order-entries="[[group.pending!.Link!, [group.pending!]]]" :player-label="orders.playerLabel" :platform-class="orders.platformClass">
      <template #buy-amount="{ row }">
        {{ row.BetMoney == null ? '待核实' : toFixed(pmOrderStakeDisplayCny(row), 0) }}
      </template>
      <template #row-actions>
        <ProgressPanel v-if="group.execution" :execution="group.execution" :read-only="!hasRuntimeRecord(group.execution)" />
      </template>
    </OrderList>
  </section>
</template>
