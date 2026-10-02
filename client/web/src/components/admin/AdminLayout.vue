<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getMatcherUrl } from "@/config/apiBase";
import { useUserStore } from "@/stores/userStore";

defineProps<{
  title?: string;
  subtitle?: string;
}>();

const route = useRoute();
const router = useRouter();
const user = useUserStore();

type AdminNavItem = {
  name: string;
  label: string;
  icon: string;
  to?: { name: string };
  href?: string;
};

const navItems: AdminNavItem[] = [
  { name: 'admin-certificates', label: '用户证书', icon: 'am-icon-lock', to: { name: 'admin-certificates' } },
  { name: "admin", label: "数据概览", icon: "am-icon-dashboard", to: { name: "admin" } },
  { name: "admin-users", label: "用户管理", icon: "am-icon-users", to: { name: "admin-users" } },
  { name: "admin-leaderboard", label: "排行榜设置", icon: "am-icon-trophy", to: { name: "admin-leaderboard" } },
  { name: "admin-accounts", label: "子账号", icon: "am-icon-credit-card", to: { name: "admin-accounts" } },
  { name: "admin-orders", label: "电竞订单查询", icon: "am-icon-gamepad", to: { name: "admin-orders" } },
  { name: "admin-football-orders", label: "足球订单", icon: "am-icon-futbol-o", to: { name: "admin-football-orders" } },
  {
    name: "admin-maintenance",
    label: "订单和用户维护",
    icon: "am-icon-exclamation-triangle",
    to: { name: "admin-maintenance" },
  },
  {
    name: "admin-reports",
    label: "电竞报表查询",
    icon: "am-icon-bar-chart",
    to: { name: "admin-reports" },
  },
  {
    name: "admin-football-reports",
    label: "足球报表查询",
    icon: "am-icon-area-chart",
    to: { name: "admin-football-reports" },
  },
  {
    name: "admin-analytics",
    label: "数据分析",
    icon: "am-icon-line-chart",
    to: { name: "admin-analytics" },
  },
  {
    name: "admin-ev-analytics",
    label: "正EV分析",
    icon: "am-icon-star",
    to: { name: "admin-ev-analytics" },
  },
  {
    name: "admin-polymarket-builder",
    label: "Poly Builder",
    icon: "am-icon-flash",
    to: { name: "admin-polymarket-builder" },
  },
  {
    name: "admin-matcher",
    label: "赛事匹配",
    icon: "am-icon-th",
    href: getMatcherUrl(),
  },
  {
    name: "admin-health",
    label: "系统健康",
    icon: "am-icon-heartbeat",
    to: { name: "admin-health" },
  },
  {
    name: "admin-value-bet",
    label: "价值买入",
    icon: "am-icon-flash",
    to: { name: "admin-value-bet" },
  },
];

const ADMIN_ONLY_NAV = new Set([
  'admin-certificates',
  "admin-leaderboard",
  "admin-polymarket-builder",
  "admin-accounts",
  "admin-maintenance",
]);

const visibleNavItems = computed(() => {
  if (user.isAdmin)
    return navItems;
  return navItems.filter(item => !ADMIN_ONLY_NAV.has(item.name));
});

const activeTab = computed(() => String(route.name || ""));

async function logout() {
  await user.logout();
  await router.push({ name: "home" });
}

onMounted(() => {
  const root = document.documentElement;
  root.classList.add("admin-route");
  // 浅色皮由 applyUiTheme 去掉 dark；默认 / 终端风管理后台仍用 EP dark
  const theme = root.getAttribute("data-ui-theme");
  if (theme !== "brutal" && theme !== "paper")
    root.classList.add("dark");
  document.addEventListener("wheel", onAdminWheel, { passive: false, capture: true });
});
onUnmounted(() => {
  document.documentElement.classList.remove("admin-route", "dark");
  document.removeEventListener("wheel", onAdminWheel, { capture: true });
});

/** body overflow:hidden 时，el-table 会截获滚轮；订单页筛选栏等非表格区域也需滚动列表 */
function onAdminWheel(e: WheelEvent) {
  const target = e.target;
  if (!(target instanceof Element))
    return;

  // 弹窗 / 抽屉 / MessageBox 内滚轮交给组件自身，勿劫持到订单列表
  if (
    target.closest(".el-overlay")
    || target.closest(".el-dialog")
    || target.closest(".el-drawer")
    || target.closest(".el-message-box")
  ) {
    return;
  }

  if (!target.closest(".admin-shell"))
    return;

  // 订单分列专用横滚容器
  const hScroll = target.closest(".admin-orders-hscroll, .admin-pf-orders-body");
  if (hScroll instanceof HTMLElement) {
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const maxX = hScroll.scrollWidth - hScroll.clientWidth;
    if (maxX > 0 && (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY))) {
      hScroll.scrollLeft = Math.max(0, Math.min(maxX, hScroll.scrollLeft + dx));
      e.preventDefault();
      return;
    }
  }

  // el-table 横向条
  const tableWrap = target.closest(".el-table .el-scrollbar__wrap, .el-table__body-wrapper");
  if (tableWrap instanceof HTMLElement) {
    const dx = e.shiftKey ? e.deltaY : e.deltaX;
    const maxX = tableWrap.scrollWidth - tableWrap.clientWidth;
    if (maxX > 0 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      tableWrap.scrollLeft = Math.max(0, Math.min(maxX, tableWrap.scrollLeft + dx));
      e.preventDefault();
      return;
    }
  }

  if (!target.closest(".el-table"))
    return;

  const scrollEl = target.closest(".admin-shell__content");
  if (!(scrollEl instanceof HTMLElement))
    return;

  const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
  if (maxScroll <= 0)
    return;

  scrollEl.scrollTop = Math.max(0, Math.min(maxScroll, scrollEl.scrollTop + e.deltaY));
  e.preventDefault();
}
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-shell__sidebar">
      <div class="admin-shell__brand">
        <i class="admin-shell__brand-icon am-icon-shield" aria-hidden="true" />
        <div class="admin-shell__brand-text">
          <span class="admin-shell__brand-title">じらいや</span>
          <span class="admin-shell__brand-sub">管理后台</span>
        </div>
      </div>

      <nav class="admin-shell__nav" aria-label="后台导航">
        <template v-for="item in visibleNavItems" :key="item.name">
          <a
            v-if="item.href"
            :href="item.href"
            class="admin-shell__nav-item"
            target="_blank"
            rel="noopener noreferrer"
          >
            <i :class="item.icon" class="admin-shell__nav-icon" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </a>
          <router-link
            v-else
            :to="item.to!"
            class="admin-shell__nav-item"
            :class="{ 'admin-shell__nav-item--active': activeTab === item.name }"
          >
            <i :class="item.icon" class="admin-shell__nav-icon" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </router-link>
        </template>
      </nav>

      <div class="admin-shell__sidebar-foot">
        <button type="button" class="admin-shell__back" @click="router.push({ name: 'home' })">
          <i class="am-icon-arrow-left admin-shell__back-icon" aria-hidden="true" />
          返回控制台
        </button>
      </div>
    </aside>

    <div class="admin-shell__main">
      <header class="admin-shell__topbar">
        <div class="admin-shell__topbar-left">
          <h1 class="admin-shell__page-title">
            {{ title || "管理后台" }}
          </h1>
          <p v-if="subtitle" class="admin-shell__page-sub">
            {{ subtitle }}
          </p>
        </div>
        <div class="admin-shell__topbar-right">
          <slot name="toolbar" />
          <div class="admin-shell__user">
            <span class="admin-shell__user-name">{{ user.userName }}</span>
            <el-button size="small" type="info" plain @click="logout">
              退出
            </el-button>
          </div>
        </div>
      </header>

      <div class="admin-shell__content">
        <slot />
      </div>
    </div>
  </div>
</template>
