<script setup lang="ts">
import type { RayOrderContext } from "@/runtime/rayOrderMonitor/types";
import type { ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import { formatOrderTime } from "@changmen/client-core/shared/format";
import { computed, ref } from "vue";
import { rayMonitoring } from "@/runtime/orderMonitoring/rayState";
import { buildRayLinkMonitorModel, rayLinkMonitorOrder } from "@/shared/rayLinkMonitor";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";

const props = defineProps<{
  rows: OrderRow[];
  run?: ActiveBetRun | null;
  monitor?: RayOrderContext | null;
}>();

const expanded = ref(false);
const user = useUserStore(); const accounts = useAccountStore();
const model = computed(() => {
  const row = rayLinkMonitorOrder(props.rows);
  const monitoring = user.isLoggedIn && !accounts.adminWorkspacePreview && rayMonitoring.owner === String(user.userId)
    ? rayMonitoring.orders.get(`${row?.PlayerID}:${row?.OrderID}`)
    : undefined;
  return buildRayLinkMonitorModel(props.rows, props.run, props.monitor, monitoring);
});
</script>

<template>
  <section
    v-if="model.visible"
    class="ray-link-monitor"
    :class="[`ray-link-monitor--${model.tone}`, { 'ray-link-monitor--expanded': expanded }]"
  >
    <button
      type="button"
      class="ray-link-monitor__summary"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="ray-link-monitor__signal" aria-hidden="true" />
      <span class="ray-link-monitor__copy">
        <span class="ray-link-monitor__title">
          <strong>RAY 订单监控</strong>
          <em>{{ model.label }}</em>
        </span>
        <span class="ray-link-monitor__subtitle">{{ model.summary }}</span>
      </span>
      <span class="ray-link-monitor__chevron" aria-hidden="true">⌄</span>
    </button>

    <div v-if="expanded" class="ray-link-monitor__detail">
      <div class="ray-link-monitor__fact">
        <span>场馆单号</span>
        <strong :title="model.orderId || '尚未绑定'">{{ model.orderId || "尚未绑定" }}</strong>
      </div>
      <div class="ray-link-monitor__fact">
        <span>最新状态</span>
        <strong>{{ model.venueStatus || "未知" }}</strong>
      </div>
      <div class="ray-link-monitor__fact">
        <span>{{ model.timeLabel ?? (model.isLive ? "最近更新" : "订单时间") }}</span>
        <strong>{{ model.observedAt ? formatOrderTime(model.observedAt) : "—" }}</strong>
      </div>
      <p v-if="model.detail" class="ray-link-monitor__note">
        {{ model.detail }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.ray-link-monitor {
  --monitor-accent: #8996aa;
  --monitor-bg: rgba(137, 150, 170, 0.09);
  margin: 5px 2px 2px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--monitor-accent) 44%, transparent);
  border-radius: 7px;
  background: linear-gradient(135deg, var(--monitor-bg), rgba(14, 21, 35, 0.34));
  box-shadow: inset 3px 0 0 var(--monitor-accent);
  white-space: normal;
}

.ray-link-monitor--info {
  --monitor-accent: #4ca5ff;
  --monitor-bg: rgba(76, 165, 255, 0.12);
}

.ray-link-monitor--warning {
  --monitor-accent: #e6a23c;
  --monitor-bg: rgba(230, 162, 60, 0.12);
}

.ray-link-monitor--danger {
  --monitor-accent: #f56c6c;
  --monitor-bg: rgba(245, 108, 108, 0.13);
}

.ray-link-monitor--success {
  --monitor-accent: #67c23a;
  --monitor-bg: rgba(103, 194, 58, 0.11);
}

.ray-link-monitor__summary {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) 14px;
  gap: 7px;
  align-items: center;
  width: 100%;
  padding: 7px 8px 7px 9px;
  color: #dfe8f6;
  text-align: left;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.ray-link-monitor__signal {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--monitor-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--monitor-accent) 17%, transparent);
}

.ray-link-monitor--info .ray-link-monitor__signal {
  animation: ray-monitor-pulse 1.8s ease-in-out infinite;
}

.ray-link-monitor__copy,
.ray-link-monitor__title {
  min-width: 0;
}

.ray-link-monitor__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ray-link-monitor__title strong {
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ray-link-monitor__title em {
  flex: 0 0 auto;
  padding: 1px 5px;
  color: var(--monitor-accent);
  font-size: 10px;
  font-style: normal;
  line-height: 15px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--monitor-accent) 12%, transparent);
}

.ray-link-monitor__subtitle {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: rgba(205, 217, 235, 0.66);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ray-link-monitor__chevron {
  color: rgba(205, 217, 235, 0.55);
  font-size: 15px;
  line-height: 1;
  transform: translateY(-1px);
  transition: transform 0.16s ease;
}

.ray-link-monitor--expanded .ray-link-monitor__chevron {
  transform: rotate(180deg) translateY(1px);
}

.ray-link-monitor__detail {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 7px 9px 8px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.ray-link-monitor__fact {
  min-width: 0;
}

.ray-link-monitor__fact span,
.ray-link-monitor__fact strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ray-link-monitor__fact span {
  color: rgba(205, 217, 235, 0.48);
  font-size: 9px;
  line-height: 13px;
}

.ray-link-monitor__fact strong {
  margin-top: 1px;
  color: rgba(230, 238, 250, 0.86);
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
}

.ray-link-monitor__note {
  grid-column: 1 / -1;
  margin: 1px 0 0;
  color: rgba(205, 217, 235, 0.62);
  font-size: 10px;
  line-height: 14px;
}

@keyframes ray-monitor-pulse {
  50% {
    opacity: 0.55;
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--monitor-accent) 8%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ray-link-monitor--info .ray-link-monitor__signal {
    animation: none;
  }
}
</style>
