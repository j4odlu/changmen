<script setup lang="ts">
import type { BetProfitMode, BetProfitAnalyticsPayload, BetProfitProviderRow } from "@/api/admin";
import { computed, ref, watch } from "vue";
import { toFixed } from "@changmen/client-core/shared/format";
import { dailyBetProfit, settledRoi, sumBetProfitRows } from "@/shared/adminBetProfit";
import AdminBetProfitAccountsSection from "./AdminBetProfitAccountsSection.vue";

const props = withDefaults(defineProps<{
  data: BetProfitAnalyticsPayload | null | undefined;
  mode?: BetProfitMode;
}>(), { mode: "valueBet" });
const ODDS_BUCKETS = ["1.00-1.49", "1.50-1.99", "2.00-2.49", "2.50-2.99", "3.00-3.99", "4.00-5.99", "6.00+"];
const filterProvider = ref("");
const providers = computed(() => (props.data?.byProvider ?? []).map(r => r.provider).sort());
watch(providers, (available) => {
  if (!available.includes(filterProvider.value)) filterProvider.value = "";
});
const filteredProviders = computed(() => (props.data?.byProvider ?? [])
  .filter(r => !filterProvider.value || r.provider === filterProvider.value));
const totals = computed(() => sumBetProfitRows(filteredProviders.value));
const accountRows = computed(() => (props.data?.byAccount ?? [])
  .filter(r => !filterProvider.value || r.provider === filterProvider.value));
const bucketRows = computed(() => ODDS_BUCKETS.map(bucket => ({
  ...sumBetProfitRows((props.data?.byOddsBucket ?? []).filter(r => r.odds_bucket === bucket
    && (!filterProvider.value || r.provider === filterProvider.value))),
  bucket,
})));
const dailyRows = computed(() => dailyBetProfit(props.data?.byDay ?? [], filterProvider.value));
const maxBucketOrders = computed(() => Math.max(...bucketRows.value.map(r => r.total_orders), 1));
const hasData = computed(() => (props.data?.byProvider?.length ?? 0) > 0);
const modeLabel = computed(() => props.mode === "obSingle" ? "仅 OB 模式" : "EV 下注");
function winRate(wins: number, losses: number): string {
  return wins + losses ? `${toFixed(wins / (wins + losses) * 100, 1)}%` : "-";
}
function rejectRate(orders: number, rejects: number): string {
  return orders ? `${toFixed(rejects / orders * 100, 1)}%` : "-";
}
function roi(row: BetProfitProviderRow): string {
  const value = settledRoi(row);
  return value == null ? "-" : `${toFixed(value, 2)}%`;
}
function barWidth(count: number): string {
  return `${toFixed(count / maxBucketOrders.value * 100, 0)}%`;
}
function fmtOdds(n: number | undefined | null): string {
  return n == null || !Number.isFinite(n) || n <= 0 ? "-" : toFixed(n, 2);
}
function fmtMoney(n: number | undefined | null): string {
  const v = n ?? 0;
  return `${v >= 0 ? "+" : ""}${toFixed(v, 2)}`;
}
</script>

<template>
  <div class="analytics-section">
    <div class="section-head">
      <h3 class="analytics-section__title">
        {{ modeLabel }}盈利状况
      </h3>
      <el-select
        v-if="providers.length > 1"
        v-model="filterProvider"
        clearable
        placeholder="全部场馆"
        size="small"
        style="width: 140px"
      >
        <el-option
          v-for="p in providers"
          :key="p"
          :label="p"
          :value="p"
        />
      </el-select>
    </div>

    <p class="section-hint">
      {{ mode === 'obSingle' ? '仅统计启用「含 OB 仅下 OB」模式的订单。' : '仅统计带 💎 标记的 EV 策略订单。' }}
      按下注归属日统计，金额统一为 CNY。买入额不含拒单与取消退款（零盈亏的最终派彩计入已结算）；已结算收益率 = 已结算盈亏 ÷ 已结算有效本金，未结算本金不参与计算。
      EV 为下单策略标记，实际盈利以订单结算为准。
    </p>
    <div v-if="!hasData" class="analytics-empty">
      所选时间暂无{{ modeLabel }}订单，可切换日期或选择「全部」。
    </div>

    <template v-else>
      <div class="profit-summary">
        <div class="profit-card">
          <span>净盈亏（含持仓已实现部分）</span>
          <strong :class="totals.total_profit >= 0 ? 'text-green' : 'text-red'">{{ fmtMoney(totals.total_profit) }}</strong>
        </div>
        <div class="profit-card">
          <span>已结算收益率</span>
          <strong :class="totals.settled_profit >= 0 ? 'text-green' : 'text-red'">{{ roi(totals) }}</strong>
        </div>
        <div class="profit-card"><span>已结算盈亏 / 有效本金</span><strong>{{ fmtMoney(totals.settled_profit) }} / {{ toFixed(totals.settled_bet, 2) }}</strong></div>
        <div class="profit-card"><span>未结算金额</span><strong>{{ toFixed(totals.pending_bet, 2) }}</strong></div>
      </div>
      <div class="vb-summary">
        <span>{{ totals.total_orders }} 笔</span>
        <span>胜 {{ totals.wins }} / 负 {{ totals.losses }} / 拒 {{ totals.rejects }} / 退 {{ totals.returns }} / 未结 {{ totals.pending }}</span>
        <span>买入 {{ toFixed(totals.total_bet, 0) }}</span>
        <span :class="totals.total_profit >= 0 ? 'text-green' : 'text-red'">
          盈亏 {{ fmtMoney(totals.total_profit) }}
        </span>
        <span>胜率 {{ winRate(totals.wins, totals.losses) }}</span>
      </div>

      <AdminBetProfitAccountsSection :accounts="accountRows" />

      <h4 class="vb-subtitle">
        场馆
      </h4>
      <el-table :data="filteredProviders" stripe size="small" :show-header="true">
        <el-table-column prop="provider" label="场馆" width="100" />
        <el-table-column prop="total_orders" label="笔数" width="70" align="right" />
        <el-table-column label="胜/负/拒" width="110" align="right">
          <template #default="{ row }">
            {{ row.wins }}/{{ row.losses }}/{{ row.rejects }}
          </template>
        </el-table-column>
        <el-table-column label="胜率" width="70" align="right">
          <template #default="{ row }">
            {{ winRate(row.wins, row.losses) }}
          </template>
        </el-table-column>
        <el-table-column label="拒单率" width="70" align="right">
          <template #default="{ row }">
            <span :class="{ 'text-warn': row.rejects > 0 }">
              {{ rejectRate(row.total_orders, row.rejects) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="均赔" width="70" align="right">
          <template #default="{ row }">
            {{ fmtOdds(row.avg_odds) }}
          </template>
        </el-table-column>
        <el-table-column label="买入额" width="100" align="right">
          <template #default="{ row }">
            {{ toFixed(row.total_bet, 0) }}
          </template>
        </el-table-column>
        <el-table-column label="已结算收益率" width="115" align="right">
          <template #default="{ row }">{{ roi(row) }}</template>
        </el-table-column>
        <el-table-column label="未结算金额" width="110" align="right">
          <template #default="{ row }">{{ toFixed(row.pending_bet, 2) }}</template>
        </el-table-column>
        <el-table-column label="盈亏" min-width="100" align="right">
          <template #default="{ row }">
            <span :class="row.total_profit >= 0 ? 'text-green' : 'text-red'">
              {{ fmtMoney(row.total_profit) }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <h4 class="vb-subtitle">
        赔率区间
      </h4>
      <el-table :data="bucketRows" stripe size="small" :show-header="true">
        <el-table-column prop="bucket" label="赔率区间" width="110" />
        <el-table-column label="笔数" width="60" align="right">
          <template #default="{ row }">
            {{ row.total_orders || "" }}
          </template>
        </el-table-column>
        <el-table-column label="分布" min-width="140">
          <template #default="{ row }">
            <div v-if="row.total_orders" class="dist-bar-bg">
              <div
                class="dist-bar-fill"
                :class="row.total_profit >= 0 ? 'bar-green' : 'bar-red'"
                :style="{ width: barWidth(row.total_orders) }"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="胜率" width="70" align="right">
          <template #default="{ row }">
            {{ row.total_orders ? winRate(row.wins, row.losses) : "" }}
          </template>
        </el-table-column>
        <el-table-column label="均赔" width="70" align="right">
          <template #default="{ row }">
            {{ row.total_orders ? fmtOdds(row.avg_odds) : "" }}
          </template>
        </el-table-column>
        <el-table-column label="买入额" width="100" align="right">
          <template #default="{ row }">
            {{ row.total_orders ? toFixed(row.total_bet, 0) : "" }}
          </template>
        </el-table-column>
        <el-table-column label="已结算收益率" width="115" align="right">
          <template #default="{ row }">{{ row.total_orders ? roi(row) : '' }}</template>
        </el-table-column>
        <el-table-column label="盈亏" min-width="90" align="right">
          <template #default="{ row }">
            <span
              v-if="row.total_orders"
              :class="row.total_profit >= 0 ? 'text-green' : 'text-red'"
            >
              {{ fmtMoney(row.total_profit) }}
            </span>
          </template>
        </el-table-column>
      </el-table>
      <h4 class="vb-subtitle">每日盈亏</h4>
      <el-table :data="dailyRows" stripe size="small" max-height="480">
        <el-table-column prop="day" label="下注归属日" width="120" />
        <el-table-column prop="total_orders" label="笔数" width="70" align="right" />
        <el-table-column label="胜 / 负 / 未结" width="120" align="right">
          <template #default="{ row }">{{ row.wins }} / {{ row.losses }} / {{ row.pending }}</template>
        </el-table-column>
        <el-table-column label="买入额" min-width="110" align="right">
          <template #default="{ row }">{{ toFixed(row.total_bet, 2) }}</template>
        </el-table-column>
        <el-table-column label="盈亏" min-width="110" align="right">
          <template #default="{ row }"><span :class="row.total_profit >= 0 ? 'text-green' : 'text-red'">{{ fmtMoney(row.total_profit) }}</span></template>
        </el-table-column>
        <el-table-column label="已结算收益率" min-width="120" align="right">
          <template #default="{ row }">{{ roi(row) }}</template>
        </el-table-column>
        <el-table-column label="区间累计盈亏" min-width="130" align="right">
          <template #default="{ row }"><span :class="row.cumulative_profit >= 0 ? 'text-green' : 'text-red'">{{ fmtMoney(row.cumulative_profit) }}</span></template>
        </el-table-column>
      </el-table>
    </template>
  </div>
</template>

<style scoped>
.profit-summary { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
.profit-card { flex: 1; min-width: 200px; padding: 16px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.profit-card span { display: block; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.profit-card strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.analytics-section__title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--el-text-color-primary);
}
.section-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.vb-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  margin-bottom: 14px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-regular);
}
.vb-subtitle {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
}
.dist-bar-bg {
  height: 8px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  overflow: hidden;
}
.dist-bar-fill {
  height: 100%;
  border-radius: 4px;
  min-width: 2px;
}
.bar-green { background: #67c23a; }
.bar-red { background: #f56c6c; }
.text-green { color: #67c23a; }
.text-red { color: #f56c6c; }
.text-warn { color: #e6a23c; }
.analytics-empty {
  text-align: center;
  padding: 30px;
  color: var(--el-text-color-secondary);
}
.analytics-empty__hint {
  margin: 10px auto 0;
  max-width: 420px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
</style>
