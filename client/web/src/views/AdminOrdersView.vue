<script setup lang="ts">
import type { TeamRow } from "@/api/admin";
import type { AdminAccountDetail, AdminOrderRow, AdminUserRow } from "@/types/admin";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { deleteAdminOrders, getAdminOrdersAll, getAdminUsers, getTeams } from "@/api/admin";
import AdminAccountOrdersColumn from "@/components/admin/AdminAccountOrdersColumn.vue";
import AdminLayout from "@/components/admin/AdminLayout.vue";
import AdminOrderLinkLines from "@/components/admin/AdminOrderLinkLines.vue";
import AdminUserOrdersColumn from "@/components/admin/AdminUserOrdersColumn.vue";
import OrderDateNav from "@/components/order/OrderDateNav.vue";
import { compareAdminAccountKeys } from "@/shared/adminAccountSort";
import { adminAccountStubFromOrder, adminOrderDisplayProvider, countAdminPrimaryOrders } from "@/shared/adminOrderDisplay";
import { sumAdminOrdersMoneyCny } from "@/shared/adminOrderMoney";
import { todayKey } from "@/shared/dateKey";
import { useUserStore } from "@/stores/userStore";

type GroupMode = "user" | "account";
const UNGROUPED_TEAM_ID = "__none__";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const date = ref(String(route.query.date || todayKey()));
const filterProvider = ref(String(route.query.provider || ""));
const filterUserId = ref(String(route.query.userId || ""));
const activeTeamId = ref(String(route.query.teamId || ""));
const filterPlayerId = ref(
  (() => {
    const n = Number(route.query.playerId);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })(),
);
const groupMode = ref<GroupMode>(
  route.query.view === "account"
  || filterPlayerId.value
  || String(route.query.provider || "") === "PredictFun"
    ? "account"
    : "user",
);
const loading = ref(false);
const orders = ref<AdminOrderRow[]>([]);
const users = ref<AdminUserRow[]>([]);
const teams = ref<TeamRow[]>([]);
const loadError = ref("");
const columnsContainerRef = ref<HTMLElement | null>(null);
const hScrollRef = ref<HTMLElement | null>(null);
const hScrollDragging = ref(false);
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
  // 点在按钮/链接/输入上不拖拽平移
  const t = e.target;
  if (t instanceof Element && t.closest("button, a, input, textarea, select, .el-button, .order__sell-btn"))
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
  catch {
    /* ignore */
  }
}

interface AccountColumn {
  key: string;
  provider: string;
  playerId: number;
  playerName: string;
  userName: string;
  orders: AdminOrderRow[];
  accounts: AdminAccountDetail[];
}

const allAccounts = computed<AdminAccountDetail[]>(() => {
  const result: AdminAccountDetail[] = [];
  for (const user of users.value) {
    for (const acc of user.accounts ?? [])
      result.push(acc);
  }
  return result;
});

const accountById = computed(() => {
  const map = new Map<number, { account: AdminAccountDetail; user: AdminUserRow }>();
  for (const user of users.value) {
    for (const acc of user.accounts ?? [])
      map.set(Number(acc.accountId), { account: acc, user });
  }
  return map;
});

// [changmen 扩展] 管理端按团队切换订单，团队归属沿用用户管理数据。
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
    || orders.value.some(order => !knownUsers.has(order.userId))
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

const filteredOrders = computed(() => {
  const userTeams = new Map(users.value.map(user => [user.id, user.teamId || UNGROUPED_TEAM_ID]));
  let list = orders.value.filter(row =>
    (userTeams.get(row.userId) || UNGROUPED_TEAM_ID) === activeTeamId.value,
  );
  if (filterUserId.value)
    list = list.filter(r => r.userId === filterUserId.value);
  if (filterPlayerId.value)
    list = list.filter(r => Number(r.playerId) === filterPlayerId.value);
  return list;
});

const userFilterOptions = computed(() =>
  [...teamUsers.value]
    .sort((a, b) => a.userName.localeCompare(b.userName, "zh-CN"))
    .map(u => ({
      value: u.id,
      label: `${u.userName}（${u.accounts?.length ?? 0} 账号）`,
    })),
);

const userColumns = computed(() => {
  const byUser = new Map<string, AdminOrderRow[]>();
  for (const row of filteredOrders.value) {
    if (!byUser.has(row.userId))
      byUser.set(row.userId, []);
    byUser.get(row.userId)!.push(row);
  }

  const userById = new Map(users.value.map(u => [u.id, u]));
  const sourceUsers = filterUserId.value
    ? teamUsers.value.filter(u => u.id === filterUserId.value)
    : teamUsers.value;

  const cols = sourceUsers.map(user => ({
    userId: user.id,
    userName: user.userName,
    accounts: user.accounts ?? [],
    orders: byUser.get(user.id) ?? [],
  }));

  for (const [userId, userOrders] of byUser) {
    if (userById.has(userId))
      continue;
    cols.push({
      userId,
      userName: userId.slice(0, 8),
      accounts: [],
      orders: userOrders,
    });
  }

  cols.sort((a, b) => a.userName.localeCompare(b.userName, "zh-CN"));
  return cols;
});

const accountColumns = computed<AccountColumn[]>(() => {
  const byAccount = new Map<number, AccountColumn>();
  for (const row of filteredOrders.value) {
    const playerId = Number(row.playerId) || 0;
    if (!byAccount.has(playerId)) {
      const hit = accountById.value.get(playerId);
      const stub = hit ? null : adminAccountStubFromOrder(row);
      const account = hit?.account || stub;
      const accounts = account ? [account] : [];
      const provider = adminOrderDisplayProvider(row, accounts.length ? accounts : allAccounts.value);
      const userName = hit?.user.userName
        || users.value.find(u => u.id === row.userId)?.userName
        || "";
      byAccount.set(playerId, {
        key: String(playerId),
        provider,
        playerId,
        playerName: account?.playerName || row.playerName || "",
        userName,
        orders: [],
        accounts,
      });
    }
    byAccount.get(playerId)!.orders.push(row);
  }

  // Include selected user's empty accounts so operators can see which have no orders
  if (filterUserId.value) {
    const user = users.value.find(u => u.id === filterUserId.value);
    for (const acc of user?.accounts ?? []) {
      const playerId = Number(acc.accountId);
      if (filterPlayerId.value && playerId !== filterPlayerId.value)
        continue;
      if (byAccount.has(playerId))
        continue;
      byAccount.set(playerId, {
        key: String(playerId),
        provider: acc.platform || acc.platformName || "—",
        playerId,
        playerName: acc.playerName || "",
        userName: user?.userName || "",
        orders: [],
        accounts: [acc],
      });
    }
  }

  return [...byAccount.values()].sort(compareAdminAccountKeys);
});

const hasContent = computed(() =>
  groupMode.value === "account"
    ? accountColumns.value.length > 0
    : userColumns.value.length > 0,
);

const primaryOrderCount = computed(() =>
  countAdminPrimaryOrders(filteredOrders.value, allAccounts.value),
);

const linkLinesKey = computed(() =>
  `${activeTeamId.value}:${filteredOrders.value.length}:${filterUserId.value}`,
);

const profitTotal = computed(() =>
  sumAdminOrdersMoneyCny(filteredOrders.value),
);

const subtitle = computed(() =>
  groupMode.value === "account"
    ? `${selectedTeamName.value} · 按操盘账号分列，同 Link 订单以连线标识`
    : `${selectedTeamName.value} · 每位用户一列，订单按 Link 分组展示`,
);

function fmtMoney(n: number) {
  return Math.floor(n).toLocaleString();
}

async function loadUsers() {
  try {
    users.value = await getAdminUsers(date.value);
  }
  catch (e) {
    users.value = [];
    loadError.value = (e as Error).message || "加载用户团队信息失败";
  }
}

async function loadTeams() {
  try {
    teams.value = await getTeams();
  }
  catch {
    teams.value = [];
  }
}

async function loadOrders() {
  loading.value = true;
  loadError.value = "";
  try {
    const page = await getAdminOrdersAll({
      date: date.value,
      provider: filterProvider.value || undefined,
    });
    orders.value = page.list ?? [];
  }
  catch (e) {
    orders.value = [];
    loadError.value = (e as Error).message || "加载失败";
  }
  finally {
    loading.value = false;
  }
}

async function refresh() {
  await Promise.all([loadUsers(), loadOrders(), loadTeams()]);
  if (!teamTabs.value.some(team => team.id === activeTeamId.value)) {
    const selectedUser = users.value.find(user => user.id === filterUserId.value)
      || accountById.value.get(filterPlayerId.value)?.user;
    activeTeamId.value = selectedUser
      ? selectedUser.teamId || UNGROUPED_TEAM_ID
      : teamTabs.value[0]!.id;
  }
  if (filterUserId.value && !teamUsers.value.some(user => user.id === filterUserId.value))
    filterUserId.value = "";
  const selectedAccountUser = accountById.value.get(filterPlayerId.value)?.user;
  if (selectedAccountUser && (selectedAccountUser.teamId || UNGROUPED_TEAM_ID) !== activeTeamId.value)
    filterPlayerId.value = 0;
  syncRouteQuery();
}

function syncRouteQuery() {
  const query: Record<string, string> = { date: date.value };
  if (activeTeamId.value)
    query.teamId = activeTeamId.value;
  if (groupMode.value === "account")
    query.view = "account";
  if (filterUserId.value)
    query.userId = filterUserId.value;
  if (filterProvider.value.trim())
    query.provider = filterProvider.value.trim();
  if (filterPlayerId.value)
    query.playerId = String(filterPlayerId.value);
  router.replace({
    name: "admin-orders",
    query,
  });
}

function onSearch() {
  syncRouteQuery();
  void loadOrders();
}

function onUserFilterChange(userId: string | null | undefined) {
  filterUserId.value = userId || "";
  syncRouteQuery();
}

async function onTeamChange() {
  filterUserId.value = "";
  filterPlayerId.value = 0;
  syncRouteQuery();
  await nextTick();
  if (hScrollRef.value)
    hScrollRef.value.scrollLeft = 0;
}

async function onDeleteOrders(rows: AdminOrderRow[]) {
  if (!rows.length)
    return;
  const ids = rows.map(r => r.id);
  const label
    = rows.length > 1
      ? `这 ${rows.length} 笔套利订单（Link ${rows[0]?.linkId || "—"}）`
      : `订单 ${rows[0]?.orderId || ids[0]}`;
  try {
    await ElMessageBox.confirm(`确认删除 ${label}？此操作不可恢复。`, "删除订单", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  }
  catch {
    return;
  }
  try {
    const res = await deleteAdminOrders(ids);
    ElMessage.success(`已删除 ${res.deleted} 笔订单`);
    await loadOrders();
  }
  catch (e) {
    ElMessage.error((e as Error).message || "删除失败");
  }
}

watch(date, () => {
  syncRouteQuery();
  void refresh();
});

watch(groupMode, () => {
  syncRouteQuery();
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
});
</script>

<template>
  <AdminLayout title="电竞订单查询" :subtitle="subtitle">
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
          @change="onUserFilterChange"
        >
          <el-option
            v-for="opt in userFilterOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-input
          v-model="filterProvider"
          clearable
          placeholder="平台 OB/RAY..."
          size="small"
          style="width: 120px"
          @keyup.enter="onSearch"
        />
        <el-button size="small" type="primary" @click="onSearch">
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
          v-if="hasContent"
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
            <AdminUserOrdersColumn
              v-for="col in userColumns"
              :key="col.userId"
              class="admin-orders-by-user__col"
              :user-name="col.userName"
              :user-id="col.userId"
              :accounts="col.accounts"
              :orders="col.orders"
              @delete="onDeleteOrders"
            />
          </div>

          <div
            v-else
            ref="columnsContainerRef"
            class="admin-orders-by-account"
          >
            <AdminAccountOrdersColumn
              v-for="col in accountColumns"
              :key="col.key"
              :provider="col.provider"
              :player-id="col.playerId"
              :player-name="col.playerName"
              :user-name="col.userName"
              :orders="col.orders"
              :accounts="col.accounts.length ? col.accounts : allAccounts"
              @delete="onDeleteOrders"
            />
            <AdminOrderLinkLines :key="linkLinesKey" :container-ref="columnsContainerRef" />
          </div>
        </div>

        <p
          v-if="!loading && !loadError && !hasContent"
          class="admin-order-groups__empty"
        >
          {{ selectedTeamName }}在 {{ date }} 暂无符合条件的订单，可切换团队、日期或调整筛选条件。
        </p>
      </div>

      <div v-if="hasContent" class="admin-orders-profit-summary">
        <span class="admin-orders-profit-summary__label">{{ selectedTeamName }} · 利润合计</span>
        <span
          class="admin-orders-profit-summary__value"
          :class="{ pos: profitTotal > 0, neg: profitTotal < 0 }"
        >
          {{ fmtMoney(profitTotal) }}
        </span>
        <span class="admin-orders-profit-summary__meta">
          <template v-if="groupMode === 'account'">
            {{ accountColumns.length }} 个账号 · {{ primaryOrderCount }} 笔订单
          </template>
          <template v-else>
            {{ userColumns.length }} 位用户 · {{ primaryOrderCount }} 笔订单
          </template>
        </span>
      </div>
    </section>
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
