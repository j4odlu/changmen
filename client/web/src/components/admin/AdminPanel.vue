<script setup lang="ts">
import { getMatcherUrl } from "@/config/apiBase";
import type { AdminDashboard } from "@/types/admin";
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getAdminDashboard } from "@/api/admin";

const router = useRouter();
const date = ref(todayKey());
const loading = ref(false);
const dashboard = ref<AdminDashboard | null>(null);
const loadError = ref("");
const matcherUrl = getMatcherUrl();

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function fmtMoney(n: number) {
  return Math.floor(n).toLocaleString();
}

function moneyClass(n: number) {
  if (n > 0)
    return "pos";
  if (n < 0)
    return "neg";
  return "";
}

async function loadOverview() {
  loadError.value = "";
  try {
    dashboard.value = await getAdminDashboard(date.value);
  }
  catch (e) {
    dashboard.value = null;
    loadError.value = (e as Error).message || "加载失败";
  }
}

async function loadAll() {
  loading.value = true;
  try {
    await loadOverview();
  }
  finally {
    loading.value = false;
  }
}

watch(date, () => {
  void loadAll();
});

onMounted(() => {
  void loadAll();
});
</script>

<template>
  <div v-loading="loading" class="admin-dashboard">
    <section class="admin-card admin-card--toolbar">
      <div class="admin-card__toolbar">
        <div class="admin-card__toolbar-left">
          <span class="admin-card__toolbar-label">统计日期</span>
          <el-date-picker
            v-model="date"
            type="date"
            value-format="YYYY-MM-DD"
            size="small"
            placeholder="选择日期"
            style="width: 150px"
          />
        </div>
        <div class="admin-card__toolbar-right">
          <el-button size="small" @click="loadAll">
            刷新数据
          </el-button>
        </div>
      </div>
    </section>

    <p v-if="loadError" class="admin-card__empty admin-card__empty--error">
      {{ loadError }}
    </p>

    <section v-if="dashboard" class="admin-kpi-grid">
      <article
        class="admin-kpi admin-kpi--users admin-kpi--click"
        @click="router.push({ name: 'admin-users' })"
      >
        <i class="admin-kpi__icon am-icon-users" aria-hidden="true" />
        <div class="admin-kpi__body">
          <div class="admin-kpi__label">
            注册用户
          </div>
          <div class="admin-kpi__value">
            {{ dashboard.userCount }}
          </div>
        </div>
      </article>
      <article class="admin-kpi admin-kpi--active">
        <i class="admin-kpi__icon am-icon-flash" aria-hidden="true" />
        <div class="admin-kpi__body">
          <div class="admin-kpi__label">
            当日活跃
          </div>
          <div class="admin-kpi__value">
            {{ dashboard.activeUsersToday }}
          </div>
        </div>
      </article>
      <article
        class="admin-kpi admin-kpi--orders admin-kpi--click"
        @click="router.push({ name: 'admin-orders', query: { date } })"
      >
        <i class="admin-kpi__icon am-icon-gamepad" aria-hidden="true" />
        <div class="admin-kpi__body">
          <div class="admin-kpi__label">
            当日订单
          </div>
          <div class="admin-kpi__value">
            {{ dashboard.orderCount }}
          </div>
        </div>
      </article>
      <article class="admin-kpi admin-kpi--profit">
        <i class="admin-kpi__icon am-icon-arrow-circle-down" aria-hidden="true" />
        <div class="admin-kpi__body">
          <div class="admin-kpi__label">
            当日盈利
          </div>
          <div class="admin-kpi__value" :class="moneyClass(dashboard.totalMoney)">
            {{ fmtMoney(dashboard.totalMoney) }}
          </div>
        </div>
      </article>
      <article class="admin-kpi admin-kpi--volume">
        <i class="admin-kpi__icon am-icon-save" aria-hidden="true" />
        <div class="admin-kpi__body">
          <div class="admin-kpi__label">
            当日流水
          </div>
          <div class="admin-kpi__value">
            {{ fmtMoney(dashboard.totalBetMoney) }}
          </div>
        </div>
      </article>
    </section>

    <div class="admin-dashboard__grid">
      <section class="admin-card">
        <header class="admin-card__head">
          <h2 class="admin-card__title">
            快捷入口
          </h2>
        </header>
        <div class="admin-quick">
          <button
            type="button"
            class="admin-quick__item"
            @click="router.push({ name: 'admin-users' })"
          >
            <i class="am-icon-users" aria-hidden="true" />
            <span>用户管理</span>
          </button>
          <button
            type="button"
            class="admin-quick__item"
            @click="router.push({ name: 'admin-orders', query: { date } })"
          >
            <i class="am-icon-gamepad" aria-hidden="true" />
            <span>电竞订单查询</span>
          </button>
          <button
            type="button"
            class="admin-quick__item"
            @click="router.push({ name: 'admin-reports', query: { date } })"
          >
            <i class="am-icon-bar-chart" aria-hidden="true" />
            <span>电竞报表查询</span>
          </button>
          <a
            class="admin-quick__item"
            :href="matcherUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <i class="am-icon-th" aria-hidden="true" />
            <span>赛事匹配</span>
          </a>
        </div>
      </section>

      <section class="admin-card admin-card--grow admin-card--rank">
        <header class="admin-card__head">
          <h2 class="admin-card__title">
            当日盈利 TOP
          </h2>
          <span class="admin-card__meta">
            {{ date }}
            <template v-if="dashboard?.topProfit?.length"> · {{ dashboard.topProfit.length }} 人</template>
          </span>
        </header>
        <div v-if="dashboard?.topProfit?.length" class="admin-card__scroll admin-rank-scroll">
          <el-table
            :data="dashboard.topProfit"
            size="small"
            stripe
            class="admin-rank-table"
          >
            <el-table-column label="#" width="44" align="center">
              <template #default="{ $index }">
                <span class="admin-rank" :class="{ 'admin-rank--top': $index < 3 }">{{ $index + 1 }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="UserName" label="用户" min-width="80" show-overflow-tooltip />
            <el-table-column label="盈利" width="96" align="right">
              <template #default="{ row }">
                <span :class="moneyClass(row.Money)">{{ fmtMoney(row.Money) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="Count" label="订单" width="56" align="center" />
            <el-table-column label="流水" width="96" align="right">
              <template #default="{ row }">
                {{ fmtMoney(row.BetMoney ?? 0) }}
              </template>
            </el-table-column>
          </el-table>
        </div>
        <p v-else class="admin-card__empty">
          暂无用户
        </p>
      </section>
    </div>
  </div>
</template>
