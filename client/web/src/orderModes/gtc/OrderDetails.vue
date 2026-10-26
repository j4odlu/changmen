<script setup lang="ts">
import type { OrderRow } from "@/types/order";
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import { computed } from "vue";
import { gtcProgress } from "./gtcProgressState";
import { gtcOrders } from "./orderState";
import { isNativeGtcOrder } from "./core/orderRecord";
import { isGtcOriginalBuy } from "./orderDisplayProjection";
import ProgressPanel from "./ProgressPanel.vue";

const props = defineProps<{ row: OrderRow; readonly?: boolean; records?: GtcExecution[] }>();
const execution = computed(() => props.readonly
  ? undefined
  : gtcOrders.records.find(record => record.id === props.row.PmGtcExecutionId && record.owner === gtcOrders.owner
      && record.accountId === props.row.PlayerID && props.row.Type === "Polymarket" && props.row.PmSide !== "sell"
      && [record.orderId, record.plan.orderHash, `gtc-pending:${record.id}`].some(id => id && id.toLowerCase() === String(props.row.OrderID).toLowerCase()))
    ?? (props.records ?? gtcProgress.records).find(record =>
      record.id === props.row.PmGtcExecutionId && isGtcOriginalBuy(props.row, record)));
// [changmen 扩展] 只读加载不能取得执行资格；必须已有同用户、同原单且不旧于显示版本的执行记录。
const readOnly = computed(() => !execution.value || (isNativeGtcOrder(execution.value)
  ? gtcOrders.owner !== execution.value.owner
  : gtcProgress.owner !== execution.value.owner
  || !gtcProgress.records.some(record => record.id === execution.value!.id && record.owner === execution.value!.owner
    && record.revision >= execution.value!.revision && isGtcOriginalBuy(props.row, record))));
</script>

<template>
  <ProgressPanel v-if="execution" :execution="execution" :read-only="readOnly" />
  <span v-else>GTC</span>
</template>
