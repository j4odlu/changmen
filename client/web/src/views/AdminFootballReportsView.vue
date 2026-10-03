<script setup lang="ts">
import type { TeamRow } from "@/api/admin";
import type { FootballMonthReportPayload } from "@/api/footballOrder";
import type { AdminUserRow } from "@/types/admin";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getAdminUsers, getTeams } from "@/api/admin";
import { getAdminFootballMonthReport } from "@/api/footballOrder";
import AdminLayout from "@/components/admin/AdminLayout.vue";
import FootballMonthReportTable from "@/components/report/FootballMonthReportTable.vue";
import { useUserStore } from "@/stores/userStore";

/** 与后端 role_filter.UNGROUPED_TEAM_ID 一致 */
const UNGROUPED_TEAM_ID = "__none__";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const month = ref(new Date().toISOString().slice(0, 7));
const filterUserId = ref(String(route.query.userId || ""));
const filterTeamId = ref(String(route.query.teamId || ""));
const users = ref<AdminUserRow[]>([]);
const teams = ref<TeamRow[]>([]);
const loading = ref(false);
const report = ref<FootballMonthReportPayload | null>(null);
const loadError = ref("");
const filtersReady = ref(false);
let loadSeq = 0;

interface UserGroup {
  teamId: string | null;
  label: string;
  users: AdminUserRow[];
}

function sortUsersByName(list: AdminUserRow[]): AdminUserRow[] {
  return [...list].sort((a, b) =>
    a.userName.localeCompare(b.userName, "zh-CN", { sensitivity: "base" }),
  );
}

// [changmen 扩展] 足球报表沿用电竞报表的团队 Tab，与现有团队筛选共用状态。
const teamTabs = computed(() => {
  if (!userStore.isAdmin)
    return [{ id: "", name: "本团队" }];
  const tabs = [
    { id: "", name: "全部团队" },
    ...teams.value.map(team => ({ id: team.id, name: team.name })),
  ];
  const knownIds = new Set(tabs.map(team => team.id));
  for (const user of users.value) {
    if (user.teamId && !knownIds.has(user.teamId)) {
      tabs.push({ id: user.teamId, name: user.teamId });
      knownIds.add(user.teamId);
    }
  }
  tabs.push({ id: UNGROUPED_TEAM_ID, name: "未分组" });
  return tabs;
});

const selectedTeamName = computed(() => {
  if (!filterTeamId.value)
    return "";
  if (filterTeamId.value === UNGROUPED_TEAM_ID)
    return "未分组";
  return teams.value.find(t => t.id === filterTeamId.value)?.name || filterTeamId.value;
});

const usersInSelectedTeam = computed(() => {
  const tid = filterTeamId.value;
  let list = users.value;
  if (tid === UNGROUPED_TEAM_ID)
    list = users.value.filter(u => !u.teamId);
  else if (tid)
    list = users.value.filter(u => u.teamId === tid);
  return sortUsersByName(list);
});

const userGroups = computed<UserGroup[]>(() => {
  const source = usersInSelectedTeam.value;
  if (filterTeamId.value) {
    return source.length
      ? [{ teamId: filterTeamId.value, label: selectedTeamName.value, users: sortUsersByName(source) }]
      : [];
  }
  const map = new Map<string, AdminUserRow[]>();
  for (const u of source) {
    const key = u.teamId || UNGROUPED_TEAM_ID;
    if (!map.has(key))
      map.set(key, []);
    map.get(key)!.push(u);
  }
  const groups: UserGroup[] = [];
  for (const t of teams.value) {
    const list = map.get(t.id);
    if (list?.length) {
      groups.push({ teamId: t.id, label: t.name, users: sortUsersByName(list) });
      map.delete(t.id);
    }
  }
  const none = map.get(UNGROUPED_TEAM_ID);
  if (none?.length)
    groups.push({ teamId: null, label: "未分组", users: sortUsersByName(none) });
  for (const [key, list] of map) {
    if (key !== UNGROUPED_TEAM_ID && list.length)
      groups.push({ teamId: key, label: key, users: sortUsersByName(list) });
  }
  return groups;
});

const filterUserName = computed(() => {
  const fromList = users.value.find(u => u.id === filterUserId.value)?.userName || "";
  if (fromList)
    return fromList;
  return String(route.query.userName || "");
});

const pageTitle = computed(() => {
  if (filterUserId.value)
    return `${filterUserName.value || "用户"} · 足球月报表`;
  if (filterTeamId.value)
    return `${selectedTeamName.value} · 足球月报表`;
  return userStore.isAdmin ? "全站足球月报表" : "团队足球月报表";
});

const pageSubtitle = computed(() => {
  if (filterUserId.value)
    return "按用户筛选：跟单笔数、流水与盈亏（不含充提）";
  if (filterTeamId.value)
    return "按团队汇总：跟单笔数、流水与盈亏（不含充提）";
  return "按月汇总：跟单笔数、流水与盈亏（不含充提）";
});

async function loadUsers() {
  try {
    users.value = await getAdminUsers();
  }
  catch {
    users.value = [];
  }
}

async function loadTeams() {
  if (!userStore.isAdmin)
    return;
  try {
    teams.value = await getTeams();
  }
  catch {
    teams.value = [];
  }
}

async function load() {
  const seq = ++loadSeq;
  loadError.value = "";
  loading.value = true;
  try {
    const payload = await getAdminFootballMonthReport(
      month.value,
      filterUserId.value || undefined,
      userStore.isAdmin ? (filterTeamId.value || undefined) : undefined,
    );
    if (seq !== loadSeq)
      return;
    report.value = payload;
  }
  catch (e) {
    if (seq !== loadSeq)
      return;
    report.value = null;
    loadError.value = (e as Error).message || "加载失败";
  }
  finally {
    if (seq === loadSeq)
      loading.value = false;
  }
}

function syncRouteQuery() {
  const q: Record<string, string> = {};
  if (userStore.isAdmin && filterTeamId.value)
    q.teamId = filterTeamId.value;
  if (filterUserId.value) {
    q.userId = filterUserId.value;
    if (filterUserName.value)
      q.userName = filterUserName.value;
  }
  void router.replace({ name: "admin-football-reports", query: q });
}

function dropUserIfOutsideTeam() {
  if (!filterUserId.value)
    return false;
  if (!users.value.length)
    return false;
  if (usersInSelectedTeam.value.some(u => u.id === filterUserId.value))
    return false;
  filterUserId.value = "";
  return true;
}

function onFiltersChanged() {
  if (!filtersReady.value)
    return;
  syncRouteQuery();
  void load();
}

watch(month, onFiltersChanged);

watch(filterTeamId, () => {
  if (!filtersReady.value)
    return;
  if (dropUserIfOutsideTeam())
    return;
  onFiltersChanged();
});

watch(filterUserId, onFiltersChanged);

onMounted(async () => {
  if (!userStore.ready) {
    try {
      await userStore.fetchUserInfo();
    }
    catch {
      sessionStorage.setItem("gamebet:postLoginRedirect", route.fullPath);
      await router.replace({ name: "home" });
      return;
    }
  }
  if (!userStore.canAccessAdmin) {
    await router.replace({ name: "home" });
    return;
  }
  if (!userStore.isAdmin)
    filterTeamId.value = "";
  await Promise.all([loadUsers(), loadTeams()]);
  dropUserIfOutsideTeam();
  syncRouteQuery();
  filtersReady.value = true;
  await load();
});
</script>

<template>
  <AdminLayout :title="pageTitle" :subtitle="pageSubtitle">
    <section class="admin-card admin-card--report">
      <el-tabs v-model="filterTeamId" class="admin-reports-team-tabs">
        <el-tab-pane v-for="team in teamTabs" :key="team.id" :label="team.name" :name="team.id" />
      </el-tabs>
      <div class="admin-card__toolbar">
        <div class="admin-card__toolbar-left">
          <span class="admin-card__toolbar-label">统计月份</span>
          <el-date-picker
            v-model="month"
            type="month"
            placeholder="Pick a month"
            value-format="YYYY-MM"
            size="small"
            style="width: 150px"
          />
          <el-select
            v-if="userStore.isAdmin"
            v-model="filterTeamId"
            clearable
            filterable
            placeholder="全部团队"
            size="small"
            style="width: 180px"
          >
            <el-option
              v-for="t in teams"
              :key="t.id"
              :label="t.name"
              :value="t.id"
            />
            <el-option
              :value="UNGROUPED_TEAM_ID"
              label="未分组"
            />
          </el-select>
          <el-select
            v-model="filterUserId"
            clearable
            filterable
            placeholder="全部用户"
            size="small"
            style="width: 180px"
          >
            <template v-if="userStore.isAdmin && !filterTeamId && userGroups.length > 1">
              <el-option-group
                v-for="g in userGroups"
                :key="g.teamId ?? UNGROUPED_TEAM_ID"
                :label="g.label"
              >
                <el-option
                  v-for="u in g.users"
                  :key="u.id"
                  :label="u.userName"
                  :value="u.id"
                />
              </el-option-group>
            </template>
            <template v-else>
              <el-option
                v-for="u in usersInSelectedTeam"
                :key="u.id"
                :label="u.userName"
                :value="u.id"
              />
            </template>
          </el-select>
        </div>
        <div class="admin-card__toolbar-right">
          <el-button size="small" type="primary" @click="load">
            查询
          </el-button>
          <el-button size="small" @click="load">
            刷新
          </el-button>
        </div>
      </div>
      <div class="admin-card__body">
        <p v-if="loadError" class="admin-card__empty admin-card__empty--error">
          {{ loadError }}
        </p>
        <FootballMonthReportTable
          v-else
          :list="report?.list ?? []"
          :total="report?.total ?? null"
          :loading="loading"
        />
      </div>
    </section>
  </AdminLayout>
</template>

<style scoped>
.admin-reports-team-tabs {
  padding: 0 16px;
}
.admin-reports-team-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.admin-reports-team-tabs :deep(.el-tabs__item) {
  height: 44px;
  font-weight: 600;
}
.admin-reports-team-tabs :deep(.el-tabs__content) {
  display: none;
}
</style>
