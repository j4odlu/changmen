<script setup lang="ts">
import type { OrderRow } from "@/types/order";
import { defineAsyncComponent } from "vue";

defineProps<{ row: OrderRow; readonly?: boolean }>();
const GtcDetails = defineAsyncComponent(() => import("./gtc/OrderDetails.vue"));
</script>

<template>
  <GtcDetails v-if="row.Type === 'Polymarket' && row.PmSide !== 'sell' && row.PmGtcExecutionId" :row="row" :readonly="readonly" />
</template>
