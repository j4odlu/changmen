<script setup lang="ts">
import type { AdminAccountDetail, AdminOrderRow } from "@/types/admin";
import type { OrderRow } from "@/types/order";
import { computed, ref } from "vue";
import AdminOrderLogsDialog from "@/components/admin/AdminOrderLogsDialog.vue";
import OrderList from "@/components/order/OrderList.vue";
import PlatformIcon from "@/components/platform/PlatformIcon.vue";
import { accountOrderDisplayName } from "@/shared/accountDisplayName";
import { adminPlayerLabel, countAdminPrimaryOrders, groupAdminOrderEntries } from "@/shared/adminOrderDisplay";
import { sumAdminOrdersMoneyCny } from "@/shared/adminOrderMoney";

const props = withDefaults(defineProps<{
  provider: string;
  playerId: number;
  playerName: string;
  userName?: string;
  orders: AdminOrderRow[];
  accounts: AdminAccountDetail[];
}>(), {
  userName: "",
});

const emit = defineEmits<{
  delete: [rows: AdminOrderRow[]];
}>();

const logsDialogRef = ref<InstanceType<typeof AdminOrderLogsDialog> | null>(null);

const grouped = computed(() => groupAdminOrderEntries(props.orders, props.accounts));

const titleText = computed(() => {
  const acc = props.accounts.find(a => a.accountId === props.playerId);
  const account = accountOrderDisplayName(acc ?? { playerName: props.playerName, accountId: props.playerId });
  const deleted = props.orders.some(o => Number(o.playerId) === props.playerId && o.playerDeleted)
    || (acc?.active === false && acc?.description === "已删除");
  const suffix = deleted ? "（已删）" : "";
  if (props.userName)
    return `${props.userName} · ${account}${suffix}`;
  return `${props.provider} / ${account}${suffix}`;
});

const orderEntries = computed(() =>
  grouped.value.map(({ link, orderRows }) => [link, orderRows] as const),
);

const dayProfit = computed(() =>
  sumAdminOrdersMoneyCny(props.orders),
);

const primaryOrderCount = computed(() =>
  countAdminPrimaryOrders(props.orders, props.accounts),
);

function fmtMoney(n: number) {
  return Math.floor(n).toLocaleString();
}

function playerLabel(row: OrderRow) {
  const admin = adminRowForOrder(row);
  return adminPlayerLabel(row, props.accounts, admin);
}

function platformClass(row: OrderRow) {
  const acc = props.accounts.find(a => a.accountId === row.PlayerID);
  if (acc?.active)
    return "Stop";
  return undefined;
}

function adminRowsForLink(link: number) {
  return grouped.value.find(entry => entry.link === link)?.adminRows ?? [];
}

function adminRowForOrder(row: OrderRow) {
  const oid = String(row.OrderID ?? "");
  return props.orders.find(o => o.orderId === oid);
}

function openLogs(rows: AdminOrderRow[]) {
  logsDialogRef.value?.open(rows);
}

function onDeleteOne(row: OrderRow) {
  const admin = adminRowForOrder(row);
  if (admin)
    emit("delete", [admin]);
}

function onDeleteGroup(link: number) {
  const rows = adminRowsForLink(link);
  if (rows.length)
    emit("delete", rows);
}
</script>

<template>
  <div class="admin-orders-account-col">
    <header class="admin-orders-account-col__head">
      <div class="admin-orders-account-col__title">
        <PlatformIcon :platform="provider" />
        <h3 class="admin-orders-account-col__name" :title="titleText">
          {{ titleText }}
        </h3>
      </div>
      <div class="admin-orders-account-col__stats">
        <span
          class="admin-orders-account-col__profit"
          :class="{ pos: dayProfit > 0, neg: dayProfit < 0 }"
        >
          {{ fmtMoney(dayProfit) }}
        </span>
        <span class="admin-orders-account-col__meta">{{ primaryOrderCount }} 笔</span>
      </div>
    </header>

    <div v-if="!orderEntries.length" class="admin-orders-account-col__empty">
      暂无订单
    </div>

    <div v-else class="admin-orders-account-col__list">
      <OrderList
        :order-entries="orderEntries"
        :live-quotes="false"
        :player-label="playerLabel"
        :platform-class="platformClass"
      >
        <template #row-actions="{ row }">
          <el-button
            link
            type="danger"
            size="small"
            @click="onDeleteOne(row)"
          >
            删除
          </el-button>
        </template>
        <template #group-actions="{ link, rows }">
          <div class="admin-orders-account-col__group-actions">
            <el-button link type="primary" size="small" @click="openLogs(adminRowsForLink(link))">
              诊断
            </el-button>
            <el-button
              v-if="rows.length > 1"
              link
              type="danger"
              size="small"
              @click="onDeleteGroup(link)"
            >
              删除组
            </el-button>
          </div>
        </template>
      </OrderList>
    </div>

    <AdminOrderLogsDialog ref="logsDialogRef" />
  </div>
</template>
