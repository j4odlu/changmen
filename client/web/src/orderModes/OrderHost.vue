<script setup lang="ts">
import type { OrderListEntry } from "@/components/order/OrderList.vue";
import { toFixed } from "@changmen/client-core/shared/format";
import { computed } from "vue";
import OrderView from "@/components/order/OrderView.vue";
import { pmOrderStakeDisplayCny } from "@/shared/pmOrderDisplay";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { gtcProgress } from "./gtc/gtcProgressState";
import { gtcPendingDisplayRows, mergeGtcPendingDisplayEntries } from "./gtc/orderDisplayProjection";

const props = withDefaults(defineProps<{ embedded?: boolean; embeddedUserId?: string; workspace?: "esport" | "sports" }>(), { embedded: false, workspace: "esport" });
const orders = useOrderStore();
const user = useUserStore();
const executions = computed(() => props.embedded || !user.userId || gtcProgress.owner !== String(user.userId)
  ? []
  : gtcProgress.records.filter(row => row.owner === String(user.userId)));
const pendingRows = computed(() => gtcPendingDisplayRows([...orders.orders.values()].flat(), executions.value, orders.orderDate, orders.filterAccountId));
const projectOrderEntries = (entries: ReadonlyArray<OrderListEntry>) => mergeGtcPendingDisplayEntries(entries, pendingRows.value, executions.value);
</script>

<template>
  <div class="order-mode-host">
    <OrderView :embedded="embedded" :embedded-user-id="embeddedUserId" :workspace="workspace" :project-order-entries="executions.length ? projectOrderEntries : undefined">
      <template v-if="pendingRows.length" #buy-amount="{ row }">
        {{ row.PmGtcExecutionId && row.BetMoney == null ? '待核实' : toFixed(pmOrderStakeDisplayCny(row), 0) }}
      </template>
    </OrderView>
  </div>
</template>

<style scoped>
.order-mode-host { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; width: 100%; overflow: auto; }
</style>
