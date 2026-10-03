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
      <div>
        <h2 v-if="rankStyle === 'podium'" class="rank-heading">
          排行榜<span class="rank-heading-dot" />
        </h2>
        <span class="rank-style-name">{{ rankStyle === 'podium' ? `${sorted.length} 位成员 · 成员战绩` : '经典筹码榜' }}</span>
      </div>
      <el-button class="rank-style-toggle" size="small" :aria-label="`切换为${rankStyle === 'podium' ? '经典筹码榜' : '领奖台荣誉榜'}`" @click="toggleStyle">
        切换样式
      </el-button>
    </div>
    <template v-if="rankStyle === 'podium'">
      <div class="rank-honor">
        <header class="rank-honor-heading">
          <span class="rank-section-label">荣誉榜 <span>TOP 3</span></span>
          <div class="rank-honor-sort" aria-label="排名指标">
            <button
              v-for="opt in sortOptions"
              :key="opt.type"
              type="button"
              :aria-pressed="sortBy === opt.type"
              @click="sortBy = opt.type"
            >
              {{ opt.label }}
            </button>
          </div>
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
            <span class="rank-podium-title">{{ entry.place === 1 ? 'CHAMPION' : entry.place === 2 ? 'SECOND' : 'THIRD' }}</span>
            <div class="rank-avatar-ring">
              <svg v-if="entry.place === 1" class="rank-crown" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m3 7 5 4 4-7 4 7 5-4-2 11H5L3 7Z" fill="currentColor" />
                <path d="M6 21h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
              <span class="rank-honor-avatar" aria-hidden="true">{{ initial(entry.row) }}</span>
              <span class="rank-podium-place">{{ entry.place }}</span>
            </div>
            <span class="rank-honor-name">{{ entry.row.UserName }}</span>
            <div class="rank-podium-metric">
              <span class="rank-honor-value" :class="{ 'is-gain': sortBy === 'Money' && entry.row.Money > 0, 'is-loss': sortBy === 'Money' && entry.row.Money < 0 }">
                {{ honorMetric(entry.row) }}
              </span>
              <span class="rank-metric-caption">{{ metricLabel }}</span>
            </div>
          </article>
        </div>
        <div v-if="sorted.length > 3" class="rank-list-heading">
          <span>其他成员</span><span>{{ metricLabel }}</span>
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
    <div v-if="rankStyle === 'chips'" class="rank-sort flex flex-center">
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
  --rank-gold: #ad834b;
  --rank-silver: #8594a8;
  --rank-bronze: #b58672;
  width: min(680px, calc(96vw - 56px));
  padding: 8px 4px 4px;
  box-sizing: border-box;
  font-family: "Inter", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.rank-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.rank-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 6px;
  color: var(--el-text-color-primary);
  font-size: 23px;
  font-weight: 650;
  letter-spacing: -0.8px;
}

.rank-heading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rank-gold);
}

.rank-style-name { color: var(--el-text-color-secondary); font-size: 12px; }
.rank-style-toggle { border-radius: 8px; }

.rank-honor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}

.rank-section-label {
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-weight: 500;
}

.rank-section-label span {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 10px;
  letter-spacing: 1.5px;
}

.rank-honor-sort {
  display: flex;
  gap: 3px;
  padding: 4px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--el-text-color-primary) 5%, transparent);
}

.rank-honor-sort button {
  min-height: 30px;
  padding: 5px 14px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: color 160ms, background 160ms;
}

.rank-honor-sort button[aria-pressed="true"] {
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-overlay);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--el-text-color-primary) 8%, transparent);
}

.rank-honor-sort button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.rank-podium {
  display: grid;
  grid-template-columns: 1fr 1.12fr 1fr;
  align-items: end;
  gap: 12px;
  padding-top: 16px;
}

.rank-podium-member {
  --rank-accent: var(--rank-silver);
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 222px;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding: 22px 12px 20px;
  gap: 14px;
  border: 1px solid color-mix(in srgb, var(--el-text-color-primary) 9%, transparent);
  border-radius: 16px;
  background: linear-gradient(160deg, color-mix(in srgb, var(--rank-accent) 8%, var(--el-bg-color)), var(--el-bg-color) 75%);
  text-align: center;
}

.rank-podium-member--1 {
  --rank-accent: var(--rank-gold);
  grid-column: 2;
  grid-row: 1;
  min-height: 252px;
  border-color: color-mix(in srgb, var(--rank-gold) 40%, transparent);
  background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--rank-gold) 16%, transparent), transparent 75%), var(--el-bg-color);
  box-shadow: 0 8px 24px -14px color-mix(in srgb, var(--rank-gold) 35%, transparent);
}

.rank-podium-member--2 { grid-column: 1; grid-row: 1; }
.rank-podium-member--3 { --rank-accent: var(--rank-bronze); grid-column: 3; grid-row: 1; }

.rank-podium-title {
  color: var(--rank-accent);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
}

.rank-avatar-ring {
  position: relative;
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--rank-accent) 45%, transparent);
  border-radius: 50%;
}

.rank-podium-member--1 .rank-avatar-ring { width: 66px; height: 66px; margin-top: 7px; }

.rank-honor-avatar {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  color: var(--el-text-color-regular);
  background: color-mix(in srgb, var(--el-text-color-primary) 6%, var(--el-bg-color));
  font-size: 12px;
  font-weight: 600;
}

.rank-podium-member .rank-honor-avatar {
  width: calc(100% - 10px);
  height: calc(100% - 10px);
  border-radius: 50%;
  color: var(--rank-accent);
  background: color-mix(in srgb, var(--rank-accent) 12%, var(--el-bg-color));
  font-size: 21px;
  font-weight: 500;
}

.rank-crown {
  position: absolute;
  top: -19px;
  width: 23px;
  height: 23px;
  color: var(--rank-gold);
  transform: rotate(-10deg);
}

.rank-podium-place {
  position: absolute;
  bottom: -5px;
  display: grid;
  width: 21px;
  height: 21px;
  place-items: center;
  border: 3px solid var(--el-bg-color);
  border-radius: 50%;
  color: var(--el-bg-color);
  background: var(--rank-accent);
  font-size: 10px;
  font-weight: 700;
}

.rank-honor-name {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
  font-size: 13px;
  font-weight: 500;
}

.rank-podium-metric { display: flex; flex-direction: column; gap: 4px; margin-top: auto; max-width: 100%; }
.rank-metric-caption { color: var(--el-text-color-secondary); font-size: 11px; }

.rank-honor-value {
  color: var(--el-text-color-primary);
  font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.rank-podium-member .rank-honor-value { font-size: 24px; font-weight: 650; letter-spacing: -1px; }
.rank-podium-member--1 .rank-honor-value { font-size: 29px; }
.rank-honor-value.is-gain { color: var(--el-color-success); }
.rank-honor-value.is-loss { color: var(--el-color-danger); }

.rank-list-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 26px 12px 10px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.rank-honor-list { margin: 0; padding: 0; list-style: none; }

.rank-honor-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-top: 1px solid color-mix(in srgb, var(--el-text-color-primary) 6%, transparent);
  border-radius: 6px;
}

.rank-honor-row:hover { background: color-mix(in srgb, var(--el-text-color-primary) 3%, transparent); }
.rank-honor-position { flex: 0 0 24px; color: var(--el-text-color-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.rank-honor-row .rank-honor-name { flex: 1; }
.rank-honor-row .rank-honor-value { flex: 0 1 auto; text-align: right; font-size: 14px; font-weight: 500; }
.rank-profit-badge { flex: 0 0 auto; padding: 2px 6px; border-radius: 4px; color: var(--rank-gold); background: color-mix(in srgb, var(--rank-gold) 10%, transparent); font-size: 10px; }
.rank-sort { margin-top: 18px; }

@media (max-width: 520px) {
  .rank-panel--podium { padding: 4px 0; }
  .rank-podium { gap: 6px; grid-template-columns: 1fr 1.1fr 1fr; }
  .rank-podium-member { min-height: 202px; padding: 18px 6px 16px; gap: 12px; border-radius: 12px; }
  .rank-podium-member--1 { min-height: 228px; }
  .rank-podium-member .rank-honor-value { font-size: 16px; letter-spacing: -0.5px; }
  .rank-podium-member--1 .rank-honor-value { font-size: 19px; }
  .rank-podium-title { font-size: 9px; letter-spacing: 1px; }
  .rank-honor-row { gap: 8px; padding: 12px 4px; flex-wrap: wrap; }
  .rank-profit-badge { order: 1; }
  .rank-honor-sort button { padding: 5px 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .rank-honor-sort button { transition: none; }
}
</style>
