<script setup lang="ts">
import { toFixed } from "@changmen/client-core/shared/format";
import { computed, watch } from "vue";
import OrderList from "@/components/order/OrderList.vue";
import { pmOrderStakeDisplayCny } from "@/shared/pmOrderDisplay";
import { useOrderStore } from "@/stores/orderStore";
import { gtcProgress } from "./gtcProgressState";
import { gtcOrderDisplayGroups } from "./orderDisplayProjection";
import ProgressPanel from "./ProgressPanel.vue";

const props = defineProps<{ date: string; accountId: number }>();
const emit = defineEmits<{ hasOrders: [value: boolean] }>();
const orders = useOrderStore();
// Only originals absent from the ordinary order list may render a temporary progress card.
const groups = computed(() => gtcOrderDisplayGroups(
  [...orders.orders.values()].flat(),
  gtcProgress.records,
  props.date,
  props.accountId,
).filter(group => group.pending && (!props.accountId || group.pending.PlayerID === props.accountId)));
watch(() => groups.value.length > 0, value => emit("hasOrders", value), { immediate: true });
</script>

<template>
  <section v-if="groups.length || gtcProgress.error" aria-label="尚未入库的 GTC 挂单">
    <p v-if="gtcProgress.error" role="status">
      订单核对暂不可用：{{ gtcProgress.error }}
    </p>
    <OrderList v-for="group in groups" :key="group.id" :order-entries="[[group.pending!.Link!, [group.pending!]]]" :player-label="orders.playerLabel" :platform-class="orders.platformClass">
      <template #buy-amount="{ row }">
        {{ row.BetMoney == null ? '待核实' : toFixed(pmOrderStakeDisplayCny(row), 0) }}
      </template>
      <template #row-actions>
        <ProgressPanel v-if="group.execution" :execution="group.execution" />
      </template>
    </OrderList>
  </section>
</template>
