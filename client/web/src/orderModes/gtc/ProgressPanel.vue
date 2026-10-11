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
const averagePrice = computed(() => {
  const matched = Number(props.execution.matched);
  return view.value.principal != null && matched > 0
    ? String(Number((Number(view.value.principal) / matched).toFixed(6)))
    : null;
});
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
    <dl v-else-if="execution.submit !== 'rejected'" class="pm-gtc-monitor__facts">
      <div><dt>成交</dt><dd>{{ execution.matched }} / {{ execution.plan.shares }} 份</dd></div>
      <div><dt>挂单</dt><dd>{{ execution.open == null ? '待核实' : `${execution.open} 份` }}</dd></div>
      <div title="吃单成交份额"><dt>TAKER</dt><dd>{{ view.takerShares == null ? '待核实' : `${view.takerShares} 份` }}</dd></div>
      <div title="买入限价（USDC / 份）">
        <dt>限价</dt><dd>{{ execution.plan.price }}</dd>
      </div>
      <div title="挂单成交份额"><dt>MAKER</dt><dd>{{ view.makerShares == null ? '待核实' : `${view.makerShares} 份` }}</dd></div>
      <div title="成交均价（USDC / 份）">
        <dt>均价</dt><dd>{{ averagePrice == null ? Number(execution.matched) > 0 ? '待核实' : '—' : averagePrice }}</dd>
      </div>
    </dl>
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
.pm-gtc-monitor__facts { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 2px 8px; margin: 4px 0 3px; font-size: 10px; }
.pm-gtc-monitor__facts > div { display: flex; align-items: baseline; gap: 4px; }
.pm-gtc-monitor__facts dt { flex-shrink: 0; color: rgba(205, 217, 235, 0.55); }
.pm-gtc-monitor__facts dd { margin: 0; color: rgba(230, 238, 250, 0.9); font-variant-numeric: tabular-nums; }
</style>
