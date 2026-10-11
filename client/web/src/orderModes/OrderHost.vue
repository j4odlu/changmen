<script setup lang="ts">
import type { OrderListEntry } from "@/components/order/OrderList.vue";
import { toFixed } from "@changmen/client-core/shared/format";
import { computed } from "vue";
import OrderView from "@/components/order/OrderView.vue";
import { pmOrderStakeDisplayCny } from "@/shared/pmOrderDisplay";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { useGtcDisplayRecords } from "./gtc/displayRecords";
import GtcOrderDetails from "./gtc/OrderDetails.vue";
import { gtcProgress } from "./gtc/gtcProgressState";
import { gtcPendingDisplayRows, mergeGtcPendingDisplayEntries } from "./gtc/orderDisplayProjection";

const props = withDefaults(defineProps<{ embedded?: boolean; embeddedUserId?: string; workspace?: "esport" | "sports" }>(), { embedded: false, workspace: "esport" });
const orders = useOrderStore();
const user = useUserStore();
const display = useGtcDisplayRecords(() => !props.embedded);
const executions = display.records;
const displayError = computed(() => display.error.value || (gtcProgress.owner === String(user.userId) ? gtcProgress.error : ""));
const pendingRows = computed(() => gtcPendingDisplayRows([...orders.orders.values()].flat(), executions.value, orders.orderDate, orders.filterAccountId));
const projectOrderEntries = (entries: ReadonlyArray<OrderListEntry>) => mergeGtcPendingDisplayEntries(entries, pendingRows.value, executions.value);
</script>

<template>
  <div class="order-mode-host">
    <OrderView :embedded="embedded" :embedded-user-id="embeddedUserId" :workspace="workspace" :project-order-entries="executions.length ? projectOrderEntries : undefined">
      <template v-if="pendingRows.length" #buy-amount="{ row }">
        {{ row.DisplayOnly && row.BetMoney == null ? '待核实' : toFixed(pmOrderStakeDisplayCny(row), 0) }}
      </template>
      <template v-if="executions.length" #row-actions="{ row }">
        <GtcOrderDetails v-if="row.Type === 'Polymarket' && row.PmSide !== 'sell' && row.PmGtcExecutionId" :row="row" :records="executions" />
      </template>
    </OrderView>
    <p v-if="!embedded && displayError" role="status">订单核对暂不可用：{{ displayError }}</p>
  </div>
</template>

<style scoped>
.order-mode-host { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; width: 100%; overflow: auto; }
</style>
