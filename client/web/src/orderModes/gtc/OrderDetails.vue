<script setup lang="ts">
import type { OrderRow } from "@/types/order";
import { computed } from "vue";
import { gtcProgress } from "./gtcProgressState";
import { isGtcOriginalBuy } from "./orderDisplayProjection";
import ProgressPanel from "./ProgressPanel.vue";

const props = defineProps<{ row: OrderRow; readonly?: boolean }>();
const execution = computed(() => props.readonly
  ? undefined
  : gtcProgress.records.find(record =>
      record.id === props.row.PmGtcExecutionId && isGtcOriginalBuy(props.row, record)));
</script>

<template>
  <ProgressPanel v-if="execution" :execution="execution" />
  <span v-else>GTC</span>
</template>
