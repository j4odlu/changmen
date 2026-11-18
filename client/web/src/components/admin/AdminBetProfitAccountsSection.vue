<script setup lang="ts">
import type { BetProfitAccountRow, BetProfitProviderRow } from "@/api/admin";
import { computed } from "vue";
import { toFixed } from "@changmen/client-core/shared/format";
import { settledRoi, userBetProfit } from "@/shared/adminBetProfit";

const props = defineProps<{ accounts: BetProfitAccountRow[] }>();
const users = computed(() => userBetProfit(props.accounts));
function roi(row: BetProfitProviderRow) {
  const value = settledRoi(row);
  return value == null ? "-" : `${toFixed(value, 2)}%`;
}
function money(value: number) {
  return `${value >= 0 ? "+" : ""}${toFixed(value, 2)}`;
}
</script>

<template>
  <section class="account-profit">
    <h4>用户汇总</h4>
    <el-table :data="users" stripe size="small" max-height="480">
      <el-table-column prop="user_name" label="用户账号" min-width="150" show-overflow-tooltip />
      <el-table-column prop="account_count" label="投注账号数" width="100" align="right" />
      <el-table-column prop="total_orders" label="笔数" width="75" align="right" />
      <el-table-column label="胜 / 负 / 拒 / 退 / 未结" min-width="160" align="right">
        <template #default="{ row }">{{ row.wins }} / {{ row.losses }} / {{ row.rejects }} / {{ row.returns }} / {{ row.pending }}</template>
      </el-table-column>
      <el-table-column label="买入额" min-width="110" align="right">
        <template #default="{ row }">{{ toFixed(row.total_bet, 2) }}</template>
      </el-table-column>
      <el-table-column label="已结算盈亏" min-width="115" align="right">
        <template #default="{ row }"><span :class="row.settled_profit >= 0 ? 'profit-positive' : 'profit-negative'">{{ money(row.settled_profit) }}</span></template>
      </el-table-column>
      <el-table-column label="已结算收益率" min-width="120" align="right">
        <template #default="{ row }">{{ roi(row) }}</template>
      </el-table-column>
      <el-table-column label="未结算金额" min-width="115" align="right">
        <template #default="{ row }">{{ toFixed(row.pending_bet, 2) }}</template>
      </el-table-column>
      <el-table-column prop="total_profit" label="净盈亏" min-width="115" align="right" sortable>
        <template #default="{ row }"><span :class="row.total_profit >= 0 ? 'profit-positive' : 'profit-negative'">{{ money(row.total_profit) }}</span></template>
      </el-table-column>
    </el-table>

    <h4>投注账号汇总</h4>
    <el-table :data="accounts" stripe size="small" max-height="480">
      <el-table-column label="所属用户" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">{{ row.user_name || row.user_id }}</template>
      </el-table-column>
      <el-table-column prop="provider" label="场馆" width="105" />
      <el-table-column label="投注账号" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.account_name }}<span v-if="row.account_deleted">（已删除）</span></template>
      </el-table-column>
      <el-table-column prop="player_id" label="账号 ID" width="90" />
      <el-table-column prop="total_orders" label="笔数" width="75" align="right" />
      <el-table-column label="买入额" min-width="110" align="right">
        <template #default="{ row }">{{ toFixed(row.total_bet, 2) }}</template>
      </el-table-column>
      <el-table-column label="已结算盈亏" min-width="115" align="right">
        <template #default="{ row }"><span :class="row.settled_profit >= 0 ? 'profit-positive' : 'profit-negative'">{{ money(row.settled_profit) }}</span></template>
      </el-table-column>
      <el-table-column label="已结算收益率" min-width="120" align="right">
        <template #default="{ row }">{{ roi(row) }}</template>
      </el-table-column>
      <el-table-column label="未结算金额" min-width="115" align="right">
        <template #default="{ row }">{{ toFixed(row.pending_bet, 2) }}</template>
      </el-table-column>
      <el-table-column prop="total_profit" label="净盈亏" min-width="115" align="right" sortable>
        <template #default="{ row }"><span :class="row.total_profit >= 0 ? 'profit-positive' : 'profit-negative'">{{ money(row.total_profit) }}</span></template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.account-profit h4 { margin: 16px 0 8px; font-size: 13px; font-weight: 600; }
.profit-positive { color: #67c23a; }
.profit-negative { color: #f56c6c; }
</style>
