<script setup lang="ts">
import type { AdminUserRow } from "@/types/admin";
import type { AdminOrderRow } from "@/types/admin";
import type { FootballOrderDto } from "@/api/footballOrder";
import type { TeamRow } from "@/api/admin";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getAdminUsers, getTeams } from "@/api/admin";
import { deleteAdminFootballOrders, getAdminFootballOrders } from "@/api/footballOrder";
import AdminLayout from "@/components/admin/AdminLayout.vue";
import AdminOrderLogsDialog from "@/components/admin/AdminOrderLogsDialog.vue";
import FootballOrderList from "@/components/football/FootballOrderList.vue";
import OrderDateNav from "@/components/order/OrderDateNav.vue";
import { todayKey } from "@/shared/dateKey";
import { compareAdminAccountKeys } from "@/shared/adminAccountSort";
import { footballOrderSettledProfit } from "@/runtime/podSportOrders";
import { useUserStore } from "@/stores/userStore";

type GroupMode = "user" | "account";
const UNGROUPED_TEAM_ID = "__none__";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const date = ref(String(route.query.date || todayKey()));
const filterUserId = ref(String(route.query.userId || ""));
const activeTeamId = ref(String(route.query.teamId || ""));
const groupMode = ref<GroupMode>(route.query.view === "account" ? "account" : "user");
const loading = ref(false);
const loadError = ref("");
const orders = ref<FootballOrderDto[]>([]);
const profitLabel = computed(() => date.value === todayKey() ? "当日盈亏" : "利润合计");
const users = ref<AdminUserRow[]>([]);
const teams = ref<TeamRow[]>([]);
const pageReady = ref(false);
const hScrollRef = ref<HTMLElement | null>(null);
const logsDialogRef = ref<InstanceType<typeof AdminOrderLogsDialog> | null>(null);
const hScrollDragging = ref(false);
let loadSeq = 0;
let dragStartX = 0;
let dragStartScroll = 0;

function scrollOrdersBy(dx: number) {
  const el = hScrollRef.value;
  if (!el)
    return;
  el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + dx));
}

function onHScrollPointerDown(e: PointerEvent) {
  const el = hScrollRef.value;
  if (!el || e.button !== 0)
    return;
  const t = e.target;
  if (t instanceof Element && t.closest("button, a, input, textarea, select, .el-button"))
    return;
  hScrollDragging.value = true;
  dragStartX = e.clientX;
  dragStartScroll = el.scrollLeft;
  el.setPointerCapture(e.pointerId);
}

function onHScrollPointerMove(e: PointerEvent) {
  const el = hScrollRef.value;
  if (!el || !hScrollDragging.value)
    return;
  el.scrollLeft = dragStartScroll - (e.clientX - dragStartX);
}

function onHScrollPointerUp(e: PointerEvent) {
  const el = hScrollRef.value;
  if (!el)
    return;
  hScrollDragging.value = false;
  try {
    el.releasePointerCapture(e.pointerId);
  }
  catch { /* ignore */ }
}

function sumStake(list: FootballOrderDto[]) {
  return list.reduce((sum, row) => sum + (Number(row.stake) || 0), 0);
}

function sumProfit(list: FootballOrderDto[]) {
  return list.reduce((sum, row) => sum + footballOrderSettledProfit(row), 0);
}

function fmtMoney(n: number) {
  return Math.floor(n).toLocaleString();
}

function playerLabel(row: FootballOrderDto) {
  const venue = String(row.venue || "OB").trim();
  const name = String(row.accountName || "").trim();
  if (name)
    return `${venue} / ${name}`;
  const pid = Number(row.playerId) || 0;
  return pid ? `${venue} / #${pid}` : venue;
}

function toAdminOrderRow(row: FootballOrderDto): AdminOrderRow {
  return {
    id: Number(row.rdsId) || 0,
    userId: String(row.userId || ""),
    playerId: Number(row.playerId) || 0,
    orderId: String(row.orderId || row.id || ""),
    linkId: 0,
    provider: String(row.venue || "OB"),
    match: [row.home, row.away].map(v => String(v || "").trim()).filter(Boolean).join(" vs "),
    bet: String(row.marketLabel || ""),
    item: String(row.sideLabel || ""),
    odds: Number(row.odds) || 0,
    betMoney: Number(row.stake) || 0,
    money: Number(row.profit) || 0,
    status: String(row.status || "None"),
    createAt: Number(row.at) || 0,
    domain: "sports",
    sport: "football",
    source: "football_orders",
    playerName: String(row.accountName || ""),
    platformName: String(row.venue || "OB"),
  };
}

// [changmen 扩展] 足球订单沿用电竞订单的团队 Tab 与用户归属。
const teamTabs = computed(() => {
  const visibleTeams = userStore.isAdmin
    ? teams.value
    : teams.value.filter(team => team.id === userStore.teamId
      || users.value.some(user => user.teamId === team.id));
  const tabs = visibleTeams.map(team => ({ id: team.id, name: team.name }));
  const knownIds = new Set(tabs.map(team => team.id));
  for (const user of users.value) {
    if (user.teamId && !knownIds.has(user.teamId)) {
      tabs.push({ id: user.teamId, name: user.teamId });
      knownIds.add(user.teamId);
    }
  }
  const knownUsers = new Set(users.value.map(user => user.id));
  if (users.value.some(user => !user.teamId)
    || orders.value.some(order => !knownUsers.has(String(order.userId || "")))
    || !tabs.length)
    tabs.push({ id: UNGROUPED_TEAM_ID, name: "未分组" });
  return tabs;
});

const selectedTeamName = computed(() =>
  teamTabs.value.find(team => team.id === activeTeamId.value)?.name || "团队",
);

const teamUsers = computed(() => users.value.filter(user =>
  (user.teamId || UNGROUPED_TEAM_ID) === activeTeamId.value,
));

const userFilterOptions = computed(() =>
  [...teamUsers.value]
    .sort((a, b) => a.userName.localeCompare(b.userName, "zh-CN"))
    .map(u => ({
      value: u.id,
      label: `${u.userName}（${u.accounts?.length ?? 0} 账号）`,
    })),
);

const filteredOrders = computed(() => {
  const userTeams = new Map(users.value.map(user => [user.id, user.teamId || UNGROUPED_TEAM_ID]));
  const list = orders.value.filter(row =>
    (userTeams.get(String(row.userId || "")) || UNGROUPED_TEAM_ID) === activeTeamId.value,
  );
  if (!filterUserId.value)
    return list;
  return list.filter(row => String(row.userId) === filterUserId.value);
});

const todayStake = computed(() => sumStake(filteredOrders.value));
const todayProfit = computed(() => sumProfit(filteredOrders.value));

const userColumns = computed(() => {
  const byUser = new Map<string, FootballOrderDto[]>();
  for (const row of filteredOrders.value) {
    const uid = String(row.userId || "");
    const list = byUser.get(uid) ?? [];
    list.push(row);
    byUser.set(uid, list);
  }
  const userById = new Map(users.value.map(u => [u.id, u]));
  const sourceUsers = filterUserId.value
    ? teamUsers.value.filter(u => u.id === filterUserId.value)
    : teamUsers.value;
  const cols = sourceUsers.map(user => ({
    userId: user.id,
    userName: user.userName,
    orders: byUser.get(user.id) ?? [],
    stake: sumStake(byUser.get(user.id) ?? []),
    profit: sumProfit(byUser.get(user.id) ?? []),
  }));
  for (const [userId, userOrders] of byUser) {
    if (userById.has(userId))
      continue;
    cols.push({
      userId,
      userName: userOrders[0]?.userName || userId || "未知用户",
      orders: userOrders,
      stake: sumStake(userOrders),
      profit: sumProfit(userOrders),
    });
  }
  cols.sort((a, b) => a.userName.localeCompare(b.userName, "zh-CN"));
  return cols;
});

const accountColumns = computed(() => {
  const byAccount = new Map<string, FootballOrderDto[]>();
  for (const row of filteredOrders.value) {
    const key = String(row.playerId || row.accountName || row.userId || row.id);
    const list = byAccount.get(key) ?? [];
    list.push(row);
    byAccount.set(key, list);
  }
  return [...byAccount.entries()]
    .map(([key, list]) => {
      const first = list[0]!;
      return {
        key,
        title: playerLabel(first),
        userName: list[0]?.userName || "",
        orders: list,
        stake: sumStake(list),
        profit: sumProfit(list),
        sortKey: {
          userName: String(first.userName || ""),
          provider: String(first.venue || "OB"),
          playerName: String(first.accountName || ""),
          playerId: Number(first.playerId) || 0,
        },
      };
    })
    .sort((a, b) => compareAdminAccountKeys(a.sortKey, b.sortKey));
});

const hasContent = computed(() =>
  groupMode.value === "account"
    ? accountColumns.value.length > 0
    : userColumns.value.some(col => col.orders.length > 0) || userColumns.value.length > 0,
);

const subtitle = computed(() =>
  groupMode.value === "account"
    ? `${selectedTeamName.value} · 按操盘账号分列 · OB 独立，其他场馆来自统一订单`
    : `${selectedTeamName.value} · 每位用户一列 · OB 独立，其他场馆来自统一订单`,
);

function syncQuery() {
  void router.replace({
    name: "admin-football-orders",
    query: {
      date: date.value,
      ...(activeTeamId.value ? { teamId: activeTeamId.value } : {}),
      ...(groupMode.value === "account" ? { view: "account" } : {}),
      ...(filterUserId.value ? { userId: filterUserId.value } : {}),
    },
  });
}

async function loadUsers() {
  try {
    users.value = await getAdminUsers(date.value);
  }
  catch {
    users.value = [];
  }
}

async function loadOrders() {
  const seq = ++loadSeq;
  loading.value = true;
  loadError.value = "";
  try {
    const page = await getAdminFootballOrders({
      date: date.value,
    });
    if (seq !== loadSeq)
      return;
    orders.value = page.list || [];
  }
  catch (err) {
    if (seq !== loadSeq)
      return;
    loadError.value = err instanceof Error ? err.message : String(err);
    orders.value = [];
  }
  finally {
    if (seq === loadSeq)
      loading.value = false;
  }
}

async function refresh() {
  await Promise.all([loadUsers(), loadOrders(), loadTeams()]);
  if (!teamTabs.value.some(team => team.id === activeTeamId.value)) {
    const selectedUser = users.value.find(user => user.id === filterUserId.value);
    activeTeamId.value = selectedUser
      ? selectedUser.teamId || UNGROUPED_TEAM_ID
      : teamTabs.value[0]!.id;
  }
  if (filterUserId.value && !teamUsers.value.some(user => user.id === filterUserId.value))
    filterUserId.value = "";
  syncQuery();
}

async function loadTeams() {
  try {
    teams.value = await getTeams();
  }
  catch {
    teams.value = [];
  }
}

async function onTeamChange() {
  filterUserId.value = "";
  syncQuery();
  await nextTick();
  if (hScrollRef.value)
    hScrollRef.value.scrollLeft = 0;
}

function openLogs(rows: FootballOrderDto[]) {
  const mapped = rows.map(toAdminOrderRow).filter(row => row.userId && row.orderId);
  if (!mapped.length) {
    ElMessage.warning("这笔订单缺少诊断所需信息");
    return;
  }
  logsDialogRef.value?.open(mapped);
}

async function onDeleteOrders(rows: FootballOrderDto[]) {
  const list = rows.filter(row => Number(row.rdsId) > 0);
  if (!list.length)
    return;
  const label = list.length > 1
    ? `这 ${list.length} 笔足球订单`
    : `足球订单 ${list[0]?.orderId || list[0]?.rdsId}`;
  try {
    await ElMessageBox.confirm(`确认删除 ${label}？此操作不可恢复。`, "删除足球订单", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  }
  catch {
    return;
  }
  try {
    const ids = list.map(row => Number(row.rdsId));
    const deleted = Number((await deleteAdminFootballOrders(ids)).deleted) || 0;
    ElMessage.success(`已删除 ${deleted} 笔足球订单`);
    await loadOrders();
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "删除失败");
  }
}

watch(date, () => {
  if (!pageReady.value)
    return;
  syncQuery();
  void refresh();
});

watch([filterUserId, groupMode], () => {
  if (!pageReady.value)
    return;
  syncQuery();
});

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
  await refresh();
  pageReady.value = true;
});
</script>

<template>
  <AdminLayout title="足球订单查询" :subtitle="subtitle">
    <section v-loading="loading" class="admin-card admin-card--orders">
      <el-tabs v-model="activeTeamId" class="admin-orders-team-tabs" @tab-change="onTeamChange">
        <el-tab-pane v-for="team in teamTabs" :key="team.id" :label="team.name" :name="team.id" />
      </el-tabs>
      <div class="admin-card__toolbar admin-orders-filters">
        <OrderDateNav v-model="date" placeholder="统计日期" />
        <el-radio-group v-model="groupMode" size="small">
          <el-radio-button value="user">
            按用户
          </el-radio-button>
          <el-radio-button value="account">
            按操盘账号
          </el-radio-button>
        </el-radio-group>
        <el-select
          v-model="filterUserId"
          clearable
          filterable
          placeholder="筛选用户"
          size="small"
          style="width: 180px"
        >
          <el-option
            v-for="opt in userFilterOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-button size="small" type="primary" @click="loadOrders">
          查询
        </el-button>
        <el-button size="small" @click="date = todayKey()">
          今天
        </el-button>
        <el-button size="small" @click="refresh">
          刷新
        </el-button>
        <span v-if="hasContent" class="admin-orders-hscroll-btns">
          <el-button size="small" @click="scrollOrdersBy(-360)">
            ←
          </el-button>
          <el-button size="small" @click="scrollOrdersBy(360)">
            →
          </el-button>
        </span>
      </div>

      <div class="admin-card__body admin-orders-page__body">
        <p v-if="loadError" class="admin-order-groups__empty admin-order-groups__empty--err">
          {{ loadError }}
        </p>

        <div
          v-if="!loadError && hasContent"
          ref="hScrollRef"
          class="admin-orders-hscroll"
          :class="{ 'is-dragging': hScrollDragging }"
          @pointerdown="onHScrollPointerDown"
          @pointermove="onHScrollPointerMove"
          @pointerup="onHScrollPointerUp"
          @pointercancel="onHScrollPointerUp"
        >
          <div
            v-if="groupMode === 'user'"
            class="admin-orders-by-user"
          >
            <div
              v-for="col in userColumns"
              :key="col.userId"
              class="admin-orders-user-col admin-orders-by-user__col"
            >
              <header class="admin-orders-user-col__head">
                <div class="admin-orders-user-col__title-row">
                  <h3 class="admin-orders-user-col__name">
                    {{ col.userName }}
                  </h3>
                </div>
                <span class="admin-orders-user-col__profit">
                  {{ fmtMoney(col.profit) }}
                </span>
                <span class="admin-orders-user-col__meta">{{ col.orders.length }} 笔 · 已下 {{ fmtMoney(col.stake) }}</span>
              </header>
              <div v-if="!col.orders.length" class="admin-orders-user-col__empty">
                暂无订单
              </div>
              <div v-else class="admin-orders-user-col__list">
                <FootballOrderList :rows="col.orders" :player-label="playerLabel">
                  <template #row-actions="{ row }">
                    <el-button link type="primary" size="small" @click="openLogs([row])">
                      诊断
                    </el-button>
                    <el-button link type="danger" size="small" @click="onDeleteOrders([row])">
                      删除
                    </el-button>
                  </template>
                  <template #group-actions="{ rows }">
                    <el-button link type="primary" size="small" @click="openLogs(rows)">
                      诊断
                    </el-button>
                    <el-button
                      v-if="rows.length > 1"
                      link
                      type="danger"
                      size="small"
                      @click="onDeleteOrders(rows)"
                    >
                      删除组
                    </el-button>
                  </template>
                </FootballOrderList>
              </div>
            </div>
          </div>

          <div
            v-else
            class="admin-orders-by-account"
          >
            <div
              v-for="col in accountColumns"
              :key="col.key"
              class="admin-orders-account-col"
            >
              <header class="admin-orders-account-col__head">
                <div class="admin-orders-account-col__title">
                  <h3 class="admin-orders-account-col__name" :title="col.title">
                    {{ col.title }}
                  </h3>
                </div>
                <div class="admin-orders-account-col__stats">
                  <span class="admin-orders-account-col__profit">
                    {{ fmtMoney(col.profit) }}
                  </span>
                  <span class="admin-orders-account-col__meta">{{ col.orders.length }} 笔 · 已下 {{ fmtMoney(col.stake) }} · {{ col.userName }}</span>
                </div>
              </header>
              <div class="admin-orders-account-col__list">
                <FootballOrderList :rows="col.orders" :player-label="playerLabel">
                  <template #row-actions="{ row }">
                    <el-button link type="primary" size="small" @click="openLogs([row])">
                      诊断
                    </el-button>
                    <el-button link type="danger" size="small" @click="onDeleteOrders([row])">
                      删除
                    </el-button>
                  </template>
                  <template #group-actions="{ rows }">
                    <el-button link type="primary" size="small" @click="openLogs(rows)">
                      诊断
                    </el-button>
                    <el-button
                      v-if="rows.length > 1"
                      link
                      type="danger"
                      size="small"
                      @click="onDeleteOrders(rows)"
                    >
                      删除组
                    </el-button>
                  </template>
                </FootballOrderList>
              </div>
            </div>
          </div>
        </div>

        <p
          v-if="!loading && !loadError && !filteredOrders.length && (groupMode === 'account' || !teamUsers.length)"
          class="admin-order-groups__empty"
        >
          {{ selectedTeamName }} · {{ date }} 暂无足球订单，可切换日期查看。
        </p>
      </div>

      <div v-if="filteredOrders.length" class="admin-orders-profit-summary">
        <span class="admin-orders-profit-summary__label">{{ profitLabel }}</span>
        <span class="admin-orders-profit-summary__value">
          {{ fmtMoney(todayProfit) }}
        </span>
        <span class="admin-orders-profit-summary__meta">
          已下 {{ fmtMoney(todayStake) }}
          ·
          <template v-if="groupMode === 'account'">
            {{ accountColumns.length }} 个账号 · {{ filteredOrders.length }} 笔订单
          </template>
          <template v-else>
            {{ userColumns.length }} 位用户 · {{ filteredOrders.length }} 笔订单
          </template>
        </span>
      </div>
    </section>
    <AdminOrderLogsDialog ref="logsDialogRef" />
  </AdminLayout>
</template>

<style scoped>
.admin-orders-team-tabs {
  padding: 0 16px;
}
.admin-orders-team-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.admin-orders-team-tabs :deep(.el-tabs__item) {
  height: 44px;
  font-weight: 600;
}
.admin-orders-team-tabs :deep(.el-tabs__content) {
  display: none;
}
</style>
