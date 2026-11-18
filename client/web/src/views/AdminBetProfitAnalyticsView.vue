<script setup lang="ts">
import type { BetProfitMode, BetProfitAnalyticsPayload } from "@/api/admin";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getAdminBetProfitAnalytics } from "@/api/admin";
import AdminLayout from "@/components/admin/AdminLayout.vue";
import AdminBetProfitStatsSection from "@/components/admin/AdminBetProfitStatsSection.vue";
import { todayKey } from "@/shared/dateKey";
import { useUserStore } from "@/stores/userStore";

const router = useRouter();
const user = useUserStore();
const mode = ref<BetProfitMode>("obSingle");

const rangeMode = ref<"day" | "month" | "all">("day");
const dateKey = ref(todayKey());
const monthKey = ref((() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})());

const loading = ref(false);
const errorMsg = ref("");
const valueBet = ref<BetProfitAnalyticsPayload | null>(null);
let requestId = 0;

async function fetchData() {
  const id = ++requestId;
  loading.value = true;
  errorMsg.value = "";
  valueBet.value = null;
  try {
    const body: Record<string, unknown>
      = rangeMode.value === "all"
        ? { period: "all", all: "1" }
        : rangeMode.value === "month"
          ? { month: monthKey.value }
          : { date: dateKey.value };
    const result = await getAdminBetProfitAnalytics({ ...body, mode: mode.value });
    if (id === requestId)
      valueBet.value = result;
  }
  catch (err) {
    if (id === requestId)
      errorMsg.value = err instanceof Error ? err.message : String(err);
  }
  finally {
    if (id === requestId)
      loading.value = false;
  }
}

onMounted(async () => {
  if (!user.ready) {
    try { await user.fetchUserInfo(); }
    catch {
      sessionStorage.setItem("gamebet:postLoginRedirect", "/admin/bet-profit-analytics");
      await router.replace({ name: "home" });
      return;
    }
  }
  if (!user.isAdmin) { await router.replace({ name: "home" }); return; }
  await fetchData();
});
</script>

<template>
  <AdminLayout title="下注盈利分析" subtitle="仅 OB 模式与 EV 下注的实际盈利状况（CNY）">
    <el-tabs v-model="mode" @tab-change="fetchData">
      <el-tab-pane label="仅 OB 模式" name="obSingle" />
      <el-tab-pane label="EV 下注" name="valueBet" />
    </el-tabs>
    <div class="analytics-toolbar">
      <el-radio-group v-model="rangeMode" size="small" @change="fetchData">
        <el-radio-button value="day">
          按日
        </el-radio-button>
        <el-radio-button value="month">
          按月
        </el-radio-button>
        <el-radio-button value="all">
          全部
        </el-radio-button>
      </el-radio-group>
      <el-date-picker
        v-if="rangeMode === 'day'"
        v-model="dateKey"
        type="date"
        value-format="YYYY-MM-DD"
        :clearable="false"
        size="small"
        style="width: 150px"
        @change="fetchData"
      />
      <el-date-picker
        v-if="rangeMode === 'month'"
        v-model="monthKey"
        type="month"
        value-format="YYYY-MM"
        :clearable="false"
        size="small"
        style="width: 150px"
        @change="fetchData"
      />
      <el-button size="small" :loading="loading" @click="fetchData">
        刷新
      </el-button>
    </div>

    <el-alert
      v-if="errorMsg"
      type="error"
      :title="errorMsg"
      show-icon
      :closable="false"
      class="ev-alert"
    />

    <p v-if="loading" role="status">正在加载盈利分析…</p>
    <AdminBetProfitStatsSection v-else-if="!errorMsg" :key="mode" :mode="mode" :data="valueBet" />
  </AdminLayout>
</template>

<style scoped>
.analytics-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.ev-alert {
  margin-bottom: 12px;
}
</style>
