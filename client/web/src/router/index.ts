import { createRouter, createWebHistory } from "vue-router";
import { hasAuthSession } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import GateView from "@/views/GateView.vue";

const router = createRouter({
  history: createWebHistory("/"),
  routes: [
    {
      path: "/login",
      redirect: () => "/",
    },
    {
      path: "/",
      name: "home",
      component: GateView,
      meta: { public: true },
    },
    /** Wave A：体育独立页（GateView 按路径渲染 SportsWorkspace；不改 HomeView） */
    {
      path: "/sports",
      redirect: "/sports/football",
    },
    {
      path: "/sports/:sport(football|basketball|baseball|tennis)",
      name: "sports-board",
      component: GateView,
      meta: { public: true },
    },
    {
      path: "/admin",
      name: "admin",
      component: () => import("@/views/AdminView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/users",
      name: "admin-users",
      component: () => import("@/views/AdminUsersView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/accounts",
      name: "admin-accounts",
      component: () => import("@/views/AdminAccountsView.vue"),
      meta: { requiresAdmin: true, requiresFullAdmin: true },
    },
    {
      path: "/admin/leaderboard",
      name: "admin-leaderboard",
      component: () => import("@/views/AdminLeaderboardView.vue"),
      meta: { requiresAdmin: true, requiresFullAdmin: true },
    },
    {
      path: "/admin/orders",
      name: "admin-orders",
      component: () => import("@/views/AdminOrdersView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/football-orders",
      name: "admin-football-orders",
      component: () => import("@/views/AdminFootballOrdersView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/maintenance",
      name: "admin-maintenance",
      component: () => import("@/views/AdminMaintenanceView.vue"),
      meta: { requiresAdmin: true, requiresFullAdmin: true },
    },
    {
      path: "/admin/orders-matrix",
      redirect: to => ({ name: "admin-orders", query: to.query }),
    },
    {
      path: "/admin/reports",
      name: "admin-reports",
      component: () => import("@/views/AdminReportsView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/football-reports",
      name: "admin-football-reports",
      component: () => import("@/views/AdminFootballReportsView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/analytics",
      name: "admin-analytics",
      component: () => import("@/views/AdminAnalyticsView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/ev-analytics",
      name: "admin-ev-analytics",
      component: () => import("@/views/AdminValueBetAnalyticsView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/polymarket-builder",
      name: "admin-polymarket-builder",
      component: () => import("@/views/AdminPolymarketBuilderView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/health",
      name: "admin-health",
      component: () => import("@/views/AdminHealthView.vue"),
      meta: { requiresAdmin: true },
    },
    {
      path: "/admin/value-bet",
      name: "admin-value-bet",
      component: () => import("@/views/AdminValueBetView.vue"),
      meta: { requiresAdmin: true },
    },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.public)
    return true;
  if (!hasAuthSession()) {
    if (to.fullPath !== "/") {
      sessionStorage.setItem("gamebet:postLoginRedirect", to.fullPath);
    }
    return { name: "home" };
  }
  if (to.meta.requiresAdmin) {
    const user = useUserStore();
    if (!user.ready) {
      try {
        await user.fetchUserInfo();
      }
      catch {
        return { name: "home" };
      }
    }
    if (!user.canAccessAdmin)
      return { name: "home" };
    if (to.meta.requiresFullAdmin && !user.isAdmin)
      return { name: "home" };
  }
  return true;
});

export default router;
