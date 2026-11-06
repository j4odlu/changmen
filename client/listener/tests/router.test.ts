import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteRecordRaw } from "vue-router";
const state = vi.hoisted(() => ({ routes: [] as RouteRecordRaw[], guard: undefined as undefined | ((to: any) => Promise<unknown>),
  authenticated: false, user: { ready: true, canAccessAdmin: false, isAdmin: false, fetchUserInfo: vi.fn() }, history: vi.fn() }));
vi.mock("vue-router", () => ({
  createWebHashHistory: state.history,
  createRouter: (options: { routes: RouteRecordRaw[] }) => { state.routes = options.routes; return { beforeEach: (guard: typeof state.guard) => { state.guard = guard; } }; },
}));
vi.mock("@/views/GateView.vue", () => ({ default: {} }));
vi.mock("@/api/client", () => ({ hasAuthSession: () => state.authenticated }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => state.user }));
vi.stubGlobal("window", { location: { pathname: "/listener" } });
await import("../../web/src/router");
vi.unstubAllGlobals();
beforeEach(() => {
  state.authenticated = false; state.user.ready = true; state.user.canAccessAdmin = false; state.user.isAdmin = false;
  state.user.fetchUserInfo.mockReset();
  vi.stubGlobal("sessionStorage", { setItem: vi.fn() });
});
describe("original routes and guards with listener history", () => {
  it("keeps every original route and changes only the browser history base", () => {
    expect(state.history).toHaveBeenCalledWith("/listener");
    expect(state.routes.map(route => route.path)).toEqual([
      "/admin/certificates", "/login", "/", "/sports", "/sports/:sport(football|basketball|baseball|tennis)",
      "/admin", "/admin/users", "/admin/accounts", "/admin/leaderboard", "/admin/orders", "/admin/football-orders",
      "/admin/maintenance", "/admin/orders-matrix", "/admin/reports", "/admin/football-reports", "/admin/analytics",
      "/admin/ev-analytics", "/admin/polymarket-builder", "/admin/health", "/admin/value-bet",
    ]);
  });
  it("preserves the original public-page behavior", async () => {
    expect(await state.guard!({ meta: { public: true } })).toBe(true);
  });
  it("preserves the login return path for protected routes", async () => {
    expect(await state.guard!({ meta: { requiresAdmin: true }, fullPath: "/admin/orders?page=2" })).toEqual({ name: "home" });
    expect(sessionStorage.setItem).toHaveBeenCalledWith("gamebet:postLoginRedirect", "/admin/orders?page=2");
  });
  it("preserves team leader versus full administrator permissions", async () => {
    state.authenticated = true; state.user.canAccessAdmin = true;
    expect(await state.guard!({ meta: { requiresAdmin: true } })).toBe(true);
    expect(await state.guard!({ meta: { requiresAdmin: true, requiresFullAdmin: true } })).toEqual({ name: "home" });
    state.user.isAdmin = true;
    expect(await state.guard!({ meta: { requiresAdmin: true, requiresFullAdmin: true } })).toBe(true);
  });
  it("preserves the original user-info failure fallback", async () => {
    state.authenticated = true; state.user.ready = false; state.user.fetchUserInfo.mockRejectedValueOnce(new Error("offline"));
    expect(await state.guard!({ meta: { requiresAdmin: true } })).toEqual({ name: "home" });
  });
});
