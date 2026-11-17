<script setup lang="ts">
import type { AdminOrderRow } from "@/types/admin";
import { computed, ref } from "vue";
import AdminOrderLogsDialog from "@/components/admin/AdminOrderLogsDialog.vue";
import { formatLinkId, isManualLink, isObSingleLink, isSingleLegLink, isValueBetLink } from "@changmen/client-core/shared/format";
import { formatLinkIdFull } from "@/shared/linkDisplay";
import { adminOrderBetMoneyCny, adminOrderMoneyCny, isAdminPredictionSell, sumAdminOrdersMoneyCny } from "@/shared/adminOrderMoney";
import { resolveOrderItemLabel } from "@/shared/orderItemDisplay";

const props = defineProps<{
  groups: [number, AdminOrderRow[]][];
  showUserColumn?: boolean;
  userNameById?: Map<string, string>;
}>();

const emit = defineEmits<{
  delete: [rows: AdminOrderRow[]];
}>();

const logsDialogRef = ref<InstanceType<typeof AdminOrderLogsDialog> | null>(null);

function openLogs(rows: AdminOrderRow[]) {
  logsDialogRef.value?.open(rows);
}

interface FlatOrderRow {
  rowKey: string;
  groupKey: number;
  groupIndex: number;
  groupSize: number;
  groupRowIndex: number;
  linkId: number;
  order: AdminOrderRow;
  groupRows: AdminOrderRow[];
}

const SPAN_COLUMN_LABELS = new Set(["LinkID", "Link利润"]);

const flatRows = computed<FlatOrderRow[]>(() => {
  const result: FlatOrderRow[] = [];
  props.groups.forEach(([key, rows], groupIndex) => {
    const sorted = [...rows].sort((a, b) => a.createAt - b.createAt);
    sorted.forEach((order, groupRowIndex) => {
      result.push({
        rowKey: `${key}-${order.id}`,
        groupKey: key,
        groupIndex,
        groupSize: sorted.length,
        groupRowIndex,
        linkId: sorted[0]?.linkId || 0,
        order,
        groupRows: sorted,
      });
    });
  });
  return result;
});

function fmtTime(ts: number) {
  if (!ts)
    return "—";
  return new Date(ts).toLocaleString();
}

function fmtMoney(n: number) {
  return Math.floor(n).toLocaleString();
}

function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s === "win")
    return "admin-badge--win";
  if (s === "lose")
    return "admin-badge--lose";
  if (s === "reject")
    return "admin-badge--reject";
  if (s === "pending")
    return "admin-badge--pending";
  return "";
}

function groupIsLinked(rows: AdminOrderRow[]) {
  const link = Number(rows[0]?.linkId) || 0;
  return link !== 0 && !isSingleLegLink(link) && rows.length > 1;
}

function groupMetaLabel(rows: AdminOrderRow[]) {
  const link = Number(rows[0]?.linkId) || 0;
  if (isValueBetLink(link))
    return "正EV";
  if (isObSingleLink(link))
    return "OB单边";
  if (isManualLink(link))
    return "手动";
  if (isSingleLegLink(link))
    return "单边";
  if (groupIsLinked(rows))
    return `套利 ${rows.length} 笔`;
  return "单笔";
}

function groupProfit(rows: AdminOrderRow[]) {
  return sumAdminOrdersMoneyCny(rows);
}

function groupProfitClass(rows: AdminOrderRow[]) {
  const total = groupProfit(rows);
  if (total === 0)
    return "";
  return total > 0 ? "pos" : "neg";
}

function userLabel(row: AdminOrderRow) {
  return props.userNameById?.get(row.userId) || row.userId.slice(0, 8);
}

function rowClassName({ row }: { row: FlatOrderRow }) {
  const classes = ["admin-order-group-row"];
  if (row.groupIndex % 2 === 1)
    classes.push("admin-order-group-row--alt");
  if (row.groupRowIndex > 0)
    classes.push("admin-order-group-row--inner");
  if (row.groupRowIndex === row.groupSize - 1)
    classes.push("admin-order-group-row--group-end");
  return classes.join(" ");
}

function spanMethod({
  row,
  column,
}: {
  row: FlatOrderRow;
  column: { label?: string };
}) {
  const label = column.label || "";
  if (!SPAN_COLUMN_LABELS.has(label))
    return { rowspan: 1, colspan: 1 };
  if (row.groupRowIndex === 0)
    return { rowspan: row.groupSize, colspan: 1 };
  return { rowspan: 0, colspan: 0 };
}
</script>

<template>
  <el-table
    :data="flatRows"
    row-key="rowKey"
    size="small"
    class="admin-orders-el-table"
    :row-class-name="rowClassName"
    :span-method="spanMethod"
  >
    <el-table-column label="LinkID" width="168" fixed="left" class-name="admin-order-cell--link">
      <template #default="{ row }">
        <div class="admin-order-link-cell">
          <div
            class="admin-order-link-cell__id"
            :title="formatLinkIdFull(row.linkId)"
          >
            {{ formatLinkId(row.linkId) }}
            <span
              v-if="formatLinkId(row.linkId) !== formatLinkIdFull(row.linkId)
                && formatLinkIdFull(row.linkId) !== '—'"
              class="admin-order-link-cell__full"
            >{{ formatLinkIdFull(row.linkId) }}</span>
          </div>
          <div class="admin-order-link-cell__meta">
            <span
              class="admin-order-group-bar__type"
              :class="{ 'admin-order-group-bar__type--arb': groupIsLinked(row.groupRows) }"
            >
              {{ groupMetaLabel(row.groupRows) }}
            </span>
          </div>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="OrderID" width="140" show-overflow-tooltip>
      <template #default="{ row }">
        <span class="admin-order-mono">{{ row.order.orderId || "—" }}</span>
      </template>
    </el-table-column>
    <el-table-column v-if="showUserColumn" label="用户" width="100" show-overflow-tooltip>
      <template #default="{ row }">
        {{ userLabel(row.order) }}
      </template>
    </el-table-column>
    <el-table-column label="平台" width="72" align="center" class-name="admin-order-cell--center">
      <template #default="{ row }">
        <span class="admin-order-provider">{{ row.order.provider }}</span>
      </template>
    </el-table-column>
    <el-table-column label="比赛" min-width="160" show-overflow-tooltip>
      <template #default="{ row }">
        {{ row.order.match }}
      </template>
    </el-table-column>
    <el-table-column label="盘口" min-width="140" show-overflow-tooltip>
      <template #default="{ row }">
        {{ row.order.bet }}
      </template>
    </el-table-column>
    <el-table-column label="选项" width="100" show-overflow-tooltip>
      <template #default="{ row }">
        {{ resolveOrderItemLabel(row.order.item, row.order.match) }}
      </template>
    </el-table-column>
    <el-table-column label="赔率" width="84" align="right" class-name="admin-order-cell--num">
      <template #default="{ row }">
        <span class="admin-order-num">{{ row.order.odds }}</span>
      </template>
    </el-table-column>
    <el-table-column label="金额" width="96" align="right" class-name="admin-order-cell--num">
      <template #default="{ row }">
        <span class="admin-order-num">
          {{ fmtMoney(adminOrderBetMoneyCny(row.order)) }}
          <span
            v-if="isAdminPredictionSell(row.order)"
            class="admin-order-amount-hint"
          >回款</span>
        </span>
      </template>
    </el-table-column>
    <el-table-column label="单笔盈利" width="96" align="right" class-name="admin-order-cell--num">
      <template #default="{ row }">
        <span
          class="admin-order-num"
          :class="{ pos: adminOrderMoneyCny(row.order) > 0, neg: adminOrderMoneyCny(row.order) < 0 }"
        >
          {{ fmtMoney(adminOrderMoneyCny(row.order)) }}
        </span>
      </template>
    </el-table-column>
    <el-table-column label="Link利润" width="96" align="right" class-name="admin-order-cell--num admin-order-cell--group">
      <template #default="{ row }">
        <span class="admin-order-link-profit" :class="groupProfitClass(row.groupRows)">
          {{ fmtMoney(groupProfit(row.groupRows)) }}
        </span>
      </template>
    </el-table-column>
    <el-table-column label="状态" width="88" align="center" class-name="admin-order-cell--center">
      <template #default="{ row }">
        <span class="admin-badge" :class="statusBadgeClass(row.order.status)">{{ row.order.status }}</span>
      </template>
    </el-table-column>
    <el-table-column label="时间" width="160" show-overflow-tooltip>
      <template #default="{ row }">
        <span class="admin-order-time">{{ fmtTime(row.order.createAt) }}</span>
      </template>
    </el-table-column>
    <el-table-column label="操作" min-width="168" width="200" align="center" fixed="right" class-name="admin-order-cell--center admin-order-cell--action">
      <template #default="{ row }">
        <div class="admin-order-actions">
          <el-button link type="primary" size="small" @click="openLogs(row.groupRows)">
            诊断
          </el-button>
          <el-button
            link
            type="danger"
            size="small"
            @click="emit('delete', [row.order])"
          >
            删除
          </el-button>
          <el-button
            v-if="row.groupSize > 1 && row.groupRowIndex === 0"
            link
            type="danger"
            size="small"
            @click="emit('delete', row.groupRows)"
          >
            删除组
          </el-button>
        </div>
      </template>
    </el-table-column>
  </el-table>
  <AdminOrderLogsDialog ref="logsDialogRef" />
</template>

<style scoped>
.admin-order-actions {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 6px;
  white-space: nowrap;
  width: 100%;
}

.admin-order-actions :deep(.el-button) {
  margin: 0 !important;
  padding-left: 4px !important;
  padding-right: 4px !important;
}

.admin-order-amount-hint {
  margin-left: 4px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-weight: 400;
}
</style>
