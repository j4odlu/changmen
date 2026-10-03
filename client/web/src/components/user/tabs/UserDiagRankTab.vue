<script setup lang="ts">
import type { UserProfitRow } from "@/types/esport";
import { computed, onMounted, ref } from "vue";
import { getRankList } from "@/api/esport";

const sortBy = ref<"Money" | "Count" | "BetMoney">("Money");
const rows = ref<UserProfitRow[]>([]);
const loading = ref(false);
// [changmen 扩展] 两种排行榜展示共用数据和排序，本机记住展示偏好。
const styleStorageKey = "changmen:rank-style";
const rankStyle = ref<"chips" | "podium">("podium");
try {
  if (localStorage.getItem(styleStorageKey) === "chips")
    rankStyle.value = "chips";
}
catch {
  // 禁用本地存储时仍可切换样式。
}

function toggleStyle() {
  rankStyle.value = rankStyle.value === "podium" ? "chips" : "podium";
  try {
    localStorage.setItem(styleStorageKey, rankStyle.value);
  }
  catch {
    // 展示偏好不影响排行榜功能。
  }
}

const sortOptions = [
  { label: "盈利", type: "Money" as const },
  { label: "订单量", type: "Count" as const },
  { label: "流水", type: "BetMoney" as const },
];

const topUserId = computed(() => {
  const top = [...rows.value].sort((a, b) => b.Money - a.Money)[0];
  if (!top || top.Money < 0)
    return undefined;
  return top.UserID;
});

const sorted = computed(() => {
  const list = [...rows.value];
  if (sortBy.value === "Money") {
    return list.sort((a, b) => b.Money - a.Money);
  }
  if (sortBy.value === "Count") {
    return list.filter(r => r.Count).sort((a, b) => (b.Count ?? 0) - (a.Count ?? 0));
  }
  return list.filter(r => r.BetMoney).sort((a, b) => (b.BetMoney ?? 0) - (a.BetMoney ?? 0));
});

const metricLabel = computed(() => sortOptions.find(opt => opt.type === sortBy.value)?.label ?? "盈利");
const podium = computed(() => [1, 0, 2].flatMap((index) => {
  const row = sorted.value[index];
  return row ? [{ row, place: index + 1 }] : [];
}));

function honorMetric(row: UserProfitRow) {
  return `${sortBy.value === "Money" && row.Money > 0 ? "+" : ""}${metric(row)}`;
}

function initial(row: UserProfitRow) {
  return Array.from(row.UserName || "?")[0]?.toUpperCase();
}

async function load() {
  loading.value = true;
  try {
    rows.value = await getRankList();
  }
  finally {
    loading.value = false;
  }
}

function metric(row: UserProfitRow) {
  if (sortBy.value === "Money")
    return Math.floor(row.Money).toLocaleString();
  if (sortBy.value === "Count")
    return String(row.Count ?? 0);
  return Math.floor(row.BetMoney ?? 0).toLocaleString();
}

function isBoss(row: UserProfitRow) {
  return row.UserID === topUserId.value;
}

function isLoser(row: UserProfitRow) {
  return row.Money < 0;
}

onMounted(load);
</script>

<template>
  <section v-loading="loading" class="rank-panel" :class="{ 'rank-panel--podium': rankStyle === 'podium' }" aria-label="排行榜">
    <div class="rank-toolbar">
      <span class="rank-style-name">{{ rankStyle === 'podium' ? '领奖台荣誉榜' : '经典筹码榜' }}</span>
      <el-button size="small" :aria-label="`切换为${rankStyle === 'podium' ? '经典筹码榜' : '领奖台荣誉榜'}`" @click="toggleStyle">
        切换样式
      </el-button>
    </div>
    <template v-if="rankStyle === 'podium'">
      <div class="rank-honor">
        <header class="rank-honor-heading">
          <span class="rank-honor-eyebrow">成员荣誉榜</span>
          <h2>实力，一目了然</h2>
          <p>按{{ metricLabel }}排名</p>
        </header>
        <el-empty v-if="!loading && !sorted.length" description="暂无排行数据" :image-size="64" />
        <div v-if="sorted.length" class="rank-podium" aria-label="本榜前三名">
          <article
            v-for="entry in podium"
            :key="entry.row.UserID"
            class="rank-podium-member"
            :class="`rank-podium-member--${entry.place}`"
            :aria-label="`第${entry.place}名 ${entry.row.UserName} ${metricLabel} ${honorMetric(entry.row)}`"
          >
            <span class="rank-podium-title">{{ entry.place === 1 ? '本榜冠军' : `第${entry.place}名` }}</span>
            <span class="rank-honor-avatar" aria-hidden="true">{{ initial(entry.row) }}</span>
            <span class="rank-honor-name">{{ entry.row.UserName }}</span>
            <span class="rank-honor-value" :class="{ 'is-gain': sortBy === 'Money' && entry.row.Money > 0, 'is-loss': sortBy === 'Money' && entry.row.Money < 0 }">
              {{ honorMetric(entry.row) }}
            </span>
            <div class="rank-podium-plinth">
              <span class="rank-podium-place">{{ entry.place }}</span>
              <span>{{ metricLabel }}</span>
            </div>
          </article>
        </div>
        <ol v-if="sorted.length > 3" class="rank-honor-list" start="4" aria-label="其他成员排名">
          <li v-for="(row, index) in sorted.slice(3)" :key="row.UserID" class="rank-honor-row">
            <span class="rank-honor-position">{{ String(index + 4).padStart(2, '0') }}</span>
            <span class="rank-honor-avatar" aria-hidden="true">{{ initial(row) }}</span>
            <span class="rank-honor-name">{{ row.UserName }}</span>
            <span v-if="isBoss(row)" class="rank-profit-badge">盈利榜首</span>
            <span class="rank-honor-value" :class="{ 'is-gain': sortBy === 'Money' && row.Money > 0, 'is-loss': sortBy === 'Money' && row.Money < 0 }">
              {{ honorMetric(row) }}
            </span>
          </li>
        </ol>
      </div>
    </template>
    <div v-else class="rank flex flex-wrap">
      <div
        v-for="row in sorted"
        :key="row.UserID"
        class="item"
        :class="{ lose: row.Money < 0, boss: isBoss(row), loser: isLoser(row) }"
      >
        <div class="face">
          <div class="name">
            {{ row.UserName }}
          </div>
        </div>
        <div class="profit">
          <el-tag round :type="row.Money > 0 ? 'success' : 'danger'">
            {{ metric(row) }}
          </el-tag>
        </div>
      </div>
    </div>
    <div class="rank-sort flex flex-center">
      <el-button-group size="small">
        <el-button
          v-for="opt in sortOptions"
          :key="opt.type"
          :type="sortBy === opt.type ? 'primary' : 'default'"
          @click="sortBy = opt.type"
        >
          {{ opt.label }}
        </el-button>
      </el-button-group>
    </div>
  </section>
</template>

<style scoped>
.rank-panel {
  min-width: min(400px, calc(96vw - 56px));
  max-width: 100%;
}

.rank-panel--podium {
  width: min(640px, calc(96vw - 56px));
}

.rank-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.rank-style-name {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.rank-honor {
  padding: 24px 20px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background: linear-gradient(180deg, var(--el-color-warning-light-9), var(--el-bg-color) 260px);
}

.rank-honor-heading {
  margin-bottom: 28px;
  text-align: center;
}

.rank-honor-eyebrow {
  color: var(--el-color-warning);
  font-size: 12px;
  letter-spacing: 0.15em;
}

.rank-honor-heading h2 {
  margin: 8px 0 4px;
  color: var(--el-text-color-primary);
  font-size: 22px;
  font-weight: 600;
}

.rank-honor-heading p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.rank-podium {
  display: grid;
  grid-template-columns: 1fr 1.15fr 1fr;
  align-items: end;
  gap: 12px;
}

.rank-podium-member {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.rank-podium-member--1 { grid-column: 2; grid-row: 1; }
.rank-podium-member--2 { grid-column: 1; grid-row: 1; }
.rank-podium-member--3 { grid-column: 3; grid-row: 1; }

.rank-podium-title {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.rank-podium-member--1 .rank-podium-title {
  color: var(--el-color-warning);
}

.rank-honor-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: 14px;
  font-weight: 600;
}

.rank-podium-member .rank-honor-avatar {
  width: 46px;
  height: 46px;
  border: 3px solid var(--el-bg-color);
  border-radius: 50%;
  font-size: 18px;
}

.rank-podium-member--1 .rank-honor-avatar {
  width: 58px;
  height: 58px;
  border: 2px solid var(--el-color-warning);
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  font-size: 22px;
}

.rank-honor-name {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
}

.rank-honor-value {
  color: var(--el-text-color-primary);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.rank-podium-member .rank-honor-value {
  max-width: 100%;
  font-size: 18px;
  font-weight: 600;
}

.rank-honor-value.is-gain { color: var(--el-color-success); }
.rank-honor-value.is-loss { color: var(--el-color-danger); }

.rank-podium-plinth {
  display: flex;
  width: 100%;
  min-height: 56px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 8px 8px 0 0;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: 12px;
}

.rank-podium-member--1 .rank-podium-plinth {
  min-height: 82px;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-8);
}

.rank-podium-place {
  font-size: 20px;
  font-weight: 600;
}

.rank-honor-list {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
}

.rank-honor-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.rank-honor-position {
  flex: 0 0 24px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.rank-honor-row .rank-honor-name { flex: 1; }
.rank-honor-row .rank-honor-value { flex: 0 1 auto; text-align: right; }

.rank-profit-badge {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  font-size: 11px;
}

.rank-sort { margin-top: 18px; }

@media (max-width: 520px) {
  .rank-honor { padding: 20px 12px 8px; }
  .rank-podium { gap: 6px; }
  .rank-podium-member .rank-honor-value { font-size: 14px; }
  .rank-honor-row { gap: 8px; flex-wrap: wrap; }
  .rank-profit-badge { order: 1; }
}
</style>
