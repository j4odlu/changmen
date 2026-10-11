<script setup lang="ts">
import type { OrderRow } from "@/types/order";
import { wait } from "@changmen/client-core/shared/wait";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import LoseOrderView from "@/components/order/LoseOrderView.vue";
import OrderDateNav from "@/components/order/OrderDateNav.vue";
import OrderList from "@/components/order/OrderList.vue";
import OrderMakeupStatusBar from "@/components/order/OrderMakeupStatusBar.vue";
import RayLinkMonitorCard from "@/components/order/RayLinkMonitorCard.vue";
import { loadEmbeddedUserOrders } from "@/composables/adminUserWorkspaceMount";
import { useRayRejectMonitorStore } from "@/extensions/arbBet/rayRejectMonitor/store";
import { isFootballOrderRow } from "@/shared/orderDomain";
import { mergePendingMakeupIntoOrderGroups, orderLinkMapEntries } from "@/shared/orderLink";
import { useActiveBetRunStore } from "@/stores/activeBetRunStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
    embeddedUserId?: string;
    workspace?: "esport" | "sports";
  }>(),
  { embedded: false, workspace: "esport" },
);

const orderStore = useOrderStore();
const activeBetRunStore = useActiveBetRunStore();
const rayRejectMonitorStore = useRayRejectMonitorStore();
const loseStore = useLoseOrderStore();
const userStore = useUserStore();
const { orderDate, loading, filterAccountId, accountOptions, orders, filteredOrders }
  = storeToRefs(orderStore);
const { orders: loseOrders, cancelledOrders } = storeToRefs(loseStore);
const { config } = storeToRefs(userStore);

const domainFilteredOrders = computed(() => {
  const out = new Map<number, OrderRow[]>();
  for (const [link, rows] of filteredOrders.value) {
    const next = rows.filter(row => !isFootballOrderRow(row));
    if (next.length)
      out.set(link, next);
  }
  return out;
});

const mergedOrderEntries = computed(() => {
  const merged = mergePendingMakeupIntoOrderGroups(
    domainFilteredOrders.value,
    loseOrders.value,
    config.value.makeProfit,
    cancelledOrders.value,
    userStore.extensionPrefs.makeupOddsBand,
  );
  return orderLinkMapEntries(merged);
});

const viewLoading = ref(false);

onMounted(() => {
  if (!props.embedded && userStore.userId)
    rayRejectMonitorStore.restore(String(userStore.userId));
  if (props.embedded && props.embeddedUserId && !orderStore.orders.size) {
    void loadEmbeddedUserOrders(props.embeddedUserId, orderDate.value);
  }
  else if (!props.embedded && !orderStore.orders.size) {
    void orderStore.fetchOrders();
  }
});

/** [A8 可证实] OrderView `a(c,d)`：重置账号筛选 → getOrders → finally wait(1s) */
async function reload(date?: string) {
  filterAccountId.value = 0;
  viewLoading.value = true;
  try {
    if (props.embedded && props.embeddedUserId) {
      await loadEmbeddedUserOrders(props.embeddedUserId, date ?? orderDate.value);
    }
    else {
      await orderStore.fetchOrders(date);
    }
  }
  finally {
    await wait(1000);
    viewLoading.value = false;
  }
}

const showFilteredEmpty = computed(
  () =>
    filterAccountId.value !== 0
    && mergedOrderEntries.value.length === 0
    && domainFilteredOrders.value.size > 0,
);

const showDomainEmpty = computed(
  () =>
    !loading.value
    && !viewLoading.value
    && mergedOrderEntries.value.length === 0
    && domainFilteredOrders.value.size === 0
    && orders.value.size > 0,
);

function onDateChange(value: string) {
  if (value)
    void reload(value);
}

function playerLabel(row: Parameters<typeof orderStore.playerLabel>[0]) {
  return orderStore.playerLabel(row);
}

function platformClass(row: Parameters<typeof orderStore.platformClass>[0]) {
  return orderStore.platformClass(row);
}

function onCancelMakeup(betId: number) {
  loseStore.cancelMakeupManually(betId);
}

function activeRunForLink(link: number) {
  return activeBetRunStore.visibleRuns.find(run => Number(run.linkId) === Number(link)) ?? null;
}

function rayMonitorForLink(link: number) {
  return rayRejectMonitorStore.taskForLink(link);
}

async function onLinkRebindDone() {
  await reload();
}
</script>

<template>
  <div class="order-view-stack">
    <div class="date flex flex-middle order-date-bar">
      <OrderDateNav
        v-model="orderDate"
        class="date-nav--sidebar"
        placeholder="选择日期"
        picker-width="86px"
        :disabled="loading || viewLoading"
        @change="onDateChange"
      />
      <el-select
        v-model="filterAccountId"
        class="order-account-filter"
        placeholder="Select"
        size="small"
        :disabled="loading || viewLoading"
      >
        <el-option
          v-for="opt in accountOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <el-button
        class="am-icon-refresh order-date-bar__refresh"
        size="small"
        :loading="loading || viewLoading"
        title="刷新订单"
        aria-label="刷新订单"
        @click="reload()"
      />
    </div>

    <slot name="before-orders" />

    <p v-if="showFilteredEmpty" class="order-filter-empty">
      当前账号筛选下无订单，请选「全部」或点刷新
    </p>
    <p v-else-if="showDomainEmpty" class="order-filter-empty">
      当前筛选下无订单
    </p>

    <LoseOrderView v-if="!embedded" />

    <OrderMakeupStatusBar />

    <OrderList
      :order-entries="mergedOrderEntries"
      :loading="loading || viewLoading"
      :player-label="playerLabel"
      :platform-class="platformClass"
      :allow-link-rebind="!embedded"
      :allow-pm-sell="!embedded"
      :allow-pf-sell="!embedded"
      @cancel-makeup="onCancelMakeup"
      @link-rebind-done="onLinkRebindDone"
    >
      <template #group-monitor="{ link, rows }">
        <RayLinkMonitorCard
          v-if="!embedded"
          :rows="rows"
          :run="activeRunForLink(link)"
          :monitor="rayMonitorForLink(link)"
        />
      </template>
    </OrderList>
  </div>
</template>

<style scoped>
.order-view-stack {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  width: 100%;
}

.order-view-stack > :deep(.orders) {
  flex: 1 1 auto;
  min-height: 0;
}

.order-date-bar {
  justify-content: center;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  box-sizing: border-box;
}

.order-date-bar :deep(.date-nav) {
  flex: 0 0 auto;
}

.order-date-bar__refresh {
  flex: 0 0 32px;
  width: 32px;
  min-width: 32px;
  padding: 4px 0;
}

.order-filter-empty {
  margin: 6px 8px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #999);
  text-align: center;
}

/** 侧栏账号筛选：触发器窄，下拉仍随选项文案展宽 */
.order-account-filter {
  width: 64px;
  min-width: 64px;
  flex: 0 0 64px;
}

.order-account-filter :deep(.el-select__wrapper) {
  padding-left: 4px;
  padding-right: 2px;
}

.order-account-filter :deep(.el-select__selected-item) {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-account-filter :deep(.el-select__suffix) {
  margin-left: 0;
}
</style>
