import { renderToString } from "@vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, ref } from "vue";
import type { OrderRow } from "@/types/order";

const state = vi.hoisted(() => ({ user: { isLoggedIn: true, userId: "u1" }, accounts: { adminWorkspacePreview: false } }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => state.user }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => state.accounts }));
vi.mock("@/runtime/singleLegStrategy", () => ({ pendingSingleLegPositions: ref<OrderRow[]>([]) }));
import { pendingSingleLegPositions } from "@/runtime/singleLegStrategy";
import SingleLegMonitor from "./SingleLegMonitor.vue";

beforeEach(() => {
  state.user.isLoggedIn = true;
  state.accounts.adminWorkspacePreview = false;
  (pendingSingleLegPositions as unknown as { value: OrderRow[] }).value = [];
});

describe("single-leg monitor launcher", () => {
  it("shows a zero-count launcher and empty state", async () => {
    const html = await renderToString(createSSRApp(SingleLegMonitor));
    expect(html).toContain("9999 / LOS 待处理订单 0 笔");
    expect(html).toContain("暂无需要处理的 9999 / LOS 订单");
  });
  it("shows the mode, event, account, amount, odds and receipt state", async () => {
    (pendingSingleLegPositions as unknown as { value: OrderRow[] }).value = [{
      OrderID: "original", PlayerID: 7, Type: "OB", Link: -1800000000000,
      Match: "A vs B", Bet: "地图1 获胜", Item: "A", BetMoney: 100, Odds: 1.8, Status: "Pending",
    }];
    const html = await renderToString(createSSRApp(SingleLegMonitor));
    for (const text of ["1 笔", "9999", "A vs B", "地图1 获胜", "账号 #7", "100.00", "1.800", "待确认", "original"])
      expect(html).toContain(text);
    expect(html).not.toContain("卖出");
  });
  it("hides the launcher when logged out or previewing another user", async () => {
    state.user.isLoggedIn = false;
    expect(await renderToString(createSSRApp(SingleLegMonitor))).not.toContain("<details");
    state.user.isLoggedIn = true;
    state.accounts.adminWorkspacePreview = true;
    expect(await renderToString(createSSRApp(SingleLegMonitor))).not.toContain("<details");
  });
});
