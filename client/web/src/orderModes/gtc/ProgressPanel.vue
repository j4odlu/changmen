<script setup lang="ts">
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed } from "vue";
import { gtcOrderCardView } from "./orderCardView";
import { gtcProgress } from "./gtcProgressState";
import { gtcSyncNotice } from "./syncStatus";
import { gtcPmReconciled } from "./pollingPolicy";

const props = defineProps<{ execution: GtcExecution }>();
const view = computed(() => gtcOrderCardView(props.execution));
const syncNotice = computed(() => {
  const issue = gtcProgress.queryIssues[props.execution.id];
  if (issue) return gtcSyncNotice(issue);
  const kind = view.value.queryErrorKind;
  if (kind && !(kind === "auth" && gtcProgress.recoveredAt > props.execution.observedAt))
    return gtcSyncNotice({ kind, message: props.execution.error, at: props.execution.observedAt });
  return "";
});
const otherSyncNotice = computed(() => {
  const issue = gtcProgress.otherQueryIssues[props.execution.id];
  return issue ? `${props.execution.plan.otherProvider} ${gtcSyncNotice(issue)}` : "";
});
async function cancel() {
  try {
    await ElMessageBox.confirm("只取消这笔 PM 原挂单的剩余份额。已成交部分保留，本组继续由您处理。", "取消PM挂单", { type: "warning" });
    const { cancelGtc } = await import("./runtime");
    await cancelGtc(props.execution.id);
  }
  catch (error) {
    if (error instanceof Error)
      ElMessage.error(error.message);
  }
}
</script>

<template>
  <div class="gtc-order-extra" :data-execution-id="execution.id">
    <div role="status">
      GTC · {{ execution.plan.source === 'manual' ? '手动' : '套利' }} · {{ view.state }}
    </div>
    <div v-if="view.unsubmitted">
      PM 未提交，无挂单；计划 {{ execution.plan.shares }} 份
    </div>
    <template v-else-if="execution.submit !== 'rejected'">
      <div>
        成交：{{ execution.matched }} / {{ execution.plan.shares }} 份；挂单：{{ execution.open ?? '待核实' }}<template v-if="execution.open != null">
          份
        </template>
      </div>
    </template>
    <div v-if="view.verification.length" class="gtc-order-extra__notice">
      {{ view.verification.join(' · ') }}
    </div>
    <div v-if="view.detailError" class="gtc-order-extra__notice">
      {{ view.detailError }}
    </div>
    <div v-if="syncNotice" role="status" class="gtc-order-extra__sync-notice">
      {{ syncNotice }}
    </div>
    <div v-else-if="gtcPmReconciled(execution)" class="gtc-order-extra__sync-state">
      原单成交核对已完成，已停止挂单查询。
    </div>
    <div v-if="otherSyncNotice" role="status" class="gtc-order-extra__sync-notice">
      {{ otherSyncNotice }}
    </div>
    <div v-if="execution.cancel" class="gtc-order-extra__notice">
      {{ execution.cancel.message }}
    </div>
    <details>
      <summary>GTC 详情</summary>
      <div>订单号：{{ execution.orderId ?? (execution.submit === 'rejected' ? '官方未受理' : view.unsubmitted ? '未提交' : '官方受理待核实') }}</div>
      <div>买入限价：{{ execution.plan.price }} USDC / 份</div>
      <div v-if="view.queryDiagnostic">
        最近查询：{{ view.queryDiagnostic }}；已确认成交记录仍有效。
      </div>
    </details>
    <el-button v-if="view.showCancel" size="small" type="warning" :disabled="!view.canCancel" @click="cancel">
      取消PM挂单
    </el-button>
  </div>
</template>

<style scoped>
.gtc-order-extra {
  font-size: 11px;
  line-height: 18px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.gtc-order-extra__notice { color: var(--cm-color-warning, #e6a23c); }
.gtc-order-extra__sync-notice, .gtc-order-extra__sync-state { color: var(--cm-text-secondary, #909399); }
.gtc-order-extra details { color: var(--el-text-color-secondary, #909399); }
.gtc-order-extra summary { cursor: pointer; }
</style>
