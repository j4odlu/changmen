<script setup lang="ts">
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import { formatOrderTime } from "@changmen/client-core/shared/format";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, ref } from "vue";
import { gtcProgress } from "./gtcProgressState";
import { pmGtcMonitorCardView } from "./monitorCardView";
import { gtcOrderCardView } from "./orderCardView";
import { gtcSyncNotice } from "./syncStatus";

const props = defineProps<{ execution: GtcExecution; readOnly?: boolean }>();
const cancelBusy = ref(false);
const syncIssue = computed(() => {
  const issue = gtcProgress.queryIssues[props.execution.id];
  if (issue)
    return issue;
  const kind = gtcOrderCardView(props.execution).queryErrorKind;
  if (kind && !(kind === "auth" && gtcProgress.recoveredAt > props.execution.observedAt))
    return { kind, message: props.execution.error, at: props.execution.observedAt };
  return undefined;
});
const view = computed(() => pmGtcMonitorCardView(props.execution, syncIssue.value));
const syncNotice = computed(() => syncIssue.value ? gtcSyncNotice(syncIssue.value) : "");
const saveNotice = computed(() => gtcProgress.saveIssues[props.execution.id]
  ? "后台副本同步失败，正在重试；当前订单状态按 PM 官方结果显示。"
  : "");
const observedTime = computed(() => props.execution.observedAt > 0 ? formatOrderTime(props.execution.observedAt) : "尚未取得核对结果");
async function cancel() {
  if (props.readOnly || cancelBusy.value || !view.value.canCancel)
    return;
  const { id, owner } = props.execution;
  cancelBusy.value = true;
  try {
    await ElMessageBox.confirm("只取消这笔 PM 原挂单的剩余份额。已成交部分保留。", "取消 PM 剩余挂单", { type: "warning" });
    const { cancelGtc } = await import("@/runtime/orderMonitoring/pm");
    if (props.execution.id !== id || props.execution.owner !== owner || gtcProgress.owner !== owner || !view.value.canCancel)
      throw new Error("原单状态或用户会话已变更，请重新核对");
    await cancelGtc(id);
  }
  catch (error) {
    if (error instanceof Error)
      ElMessage.error(error.message);
  }
  finally { cancelBusy.value = false; }
}
</script>

<template>
  <section class="pm-gtc-monitor" :class="`pm-gtc-monitor--${view.monitorTone}`" :data-execution-id="execution.id" aria-label="PM GTC 订单监控">
    <div class="pm-gtc-monitor__header">
      <span class="pm-gtc-monitor__signal" aria-hidden="true" />
      <strong>PM GTC 订单监控</strong>
      <em :title="view.reconciled && !syncNotice ? '原单成交核对已完成，已停止挂单查询。' : undefined">{{ view.monitorLabel }}</em>
    </div>
    <div v-if="view.unsubmitted" class="pm-gtc-monitor__notice">
      PM 未提交，无挂单；计划 {{ execution.plan.shares }} 份
    </div>
    <dl v-else-if="execution.submit !== 'rejected'" class="pm-gtc-monitor__facts">
      <div><dt>成交</dt><dd>{{ execution.matched }} / {{ execution.plan.shares }} 份</dd></div>
      <div><dt>挂单</dt><dd>{{ execution.open == null ? '待核实' : `${execution.open} 份` }}</dd></div>
      <div title="吃单成交份额">
        <dt>TAKER</dt><dd>{{ view.takerShares == null ? '待核实' : `${view.takerShares} 份` }}</dd>
      </div>
      <div title="买入限价（USDC / 份）">
        <dt>限价</dt><dd>{{ execution.plan.price }}</dd>
      </div>
      <div title="挂单成交份额">
        <dt>MAKER</dt><dd>{{ view.makerShares == null ? '待核实' : `${view.makerShares} 份` }}</dd>
      </div>
      <div title="成交均价（USDC / 份）">
        <dt>均价</dt><dd>{{ view.averagePrice == null ? Number(execution.matched) > 0 ? '待核实' : '—' : view.averagePrice }}</dd>
      </div>
    </dl>
    <div class="pm-gtc-monitor__footer">
      <span role="status">GTC · {{ execution.plan.source === 'manual' ? '手动' : '套利' }} · {{ view.state }}</span>
      <span :title="`最近核对：${observedTime}；价格单位：USDC / 份`">核对 {{ execution.observedAt > 0 ? observedTime.slice(-8) : '待核实' }}</span>
    </div>
    <div v-if="view.verification.length" class="pm-gtc-monitor__notice">
      {{ view.verification.join(' · ') }}
    </div>
    <div v-if="view.detailError" class="pm-gtc-monitor__notice">
      {{ view.detailError }}
    </div>
    <div v-if="syncNotice" role="status" class="pm-gtc-monitor__notice">
      {{ syncNotice }}
    </div>
    <div v-if="saveNotice" role="status" class="pm-gtc-monitor__notice">
      {{ saveNotice }}
    </div>
    <div v-if="view.cancelLabel" role="status" class="pm-gtc-monitor__notice">
      {{ view.cancelLabel }}
    </div>
    <button v-if="view.showCancel" type="button" class="pm-gtc-monitor__cancel" title="仅取消剩余挂单，已成交部分保留。" :disabled="readOnly || !view.canCancel || cancelBusy" @click="cancel">
      {{ cancelBusy || view.cancelInFlight ? '取消中' : view.cancelPending ? '重试取消 PM 剩余挂单' : '取消 PM 剩余挂单' }}
    </button>
    <div v-if="execution.cancel?.message && !view.cancelLabel" class="pm-gtc-monitor__notice">
      {{ execution.cancel.message }}
    </div>
    <div v-if="view.queryDiagnostic" class="pm-gtc-monitor__notice">
      最近查询：{{ view.queryDiagnostic }}；已确认成交记录仍有效。
    </div>
  </section>
</template>

<style scoped>
.pm-gtc-monitor {
  --monitor-accent: #4ca5ff;
  margin: 4px 0 2px;
  padding: 5px 8px 5px 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--monitor-accent) 44%, transparent);
  border-radius: 7px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--monitor-accent) 9%, transparent), rgba(14, 21, 35, 0.34));
  box-shadow: inset 3px 0 0 var(--monitor-accent);
  font-size: 11px;
  line-height: 14px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.pm-gtc-monitor--success { --monitor-accent: #67c23a; }
.pm-gtc-monitor--warning { --monitor-accent: #e6a23c; }
.pm-gtc-monitor--danger { --monitor-accent: #f56c6c; }
.pm-gtc-monitor__header { display: flex; align-items: center; gap: 6px; color: #dfe8f6; }
.pm-gtc-monitor__signal { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: var(--monitor-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--monitor-accent) 17%, transparent); }
.pm-gtc-monitor__header strong { font-size: 11px; }
.pm-gtc-monitor__header em { flex-shrink: 0; margin-left: auto; padding: 0 5px; color: var(--monitor-accent); font-size: 10px; font-style: normal; border-radius: 8px; background: color-mix(in srgb, var(--monitor-accent) 12%, transparent); }
.pm-gtc-monitor__facts { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 2px 8px; margin: 4px 0 3px; font-size: 10px; }
.pm-gtc-monitor__facts > div { display: flex; align-items: baseline; gap: 4px; }
.pm-gtc-monitor__facts dt { flex-shrink: 0; color: rgba(205, 217, 235, 0.55); }
.pm-gtc-monitor__facts dd { margin: 0; color: rgba(230, 238, 250, 0.9); font-variant-numeric: tabular-nums; }
.pm-gtc-monitor__footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0 6px; color: var(--cm-text-secondary, #909399); font-size: 10px; }
.pm-gtc-monitor__notice { margin-top: 3px; color: var(--cm-color-warning, #e6a23c); font-size: 10px; }
.pm-gtc-monitor__cancel {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  margin: 7px 0 0;
  padding: 7px 12px;
  color: #241707;
  border: 1px solid #f3ba62;
  border-radius: 6px;
  background: #e6a23c;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  line-height: 20px;
}
.pm-gtc-monitor__cancel:hover:not(:disabled) { background: #f0b653; }
.pm-gtc-monitor__cancel:disabled { opacity: 0.55; box-shadow: none; cursor: not-allowed; }
.pm-gtc-monitor__cancel:focus-visible { outline: 2px solid #fff1d6; outline-offset: -4px; }
</style>
