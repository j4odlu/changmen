import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { gtcProgress } from "@/orderModes/gtc/gtcProgressState";
import ActiveBetRunView from "./ActiveBetRunView.vue";

const mocks = vi.hoisted(() => ({ runs: [] as ActiveBetRun[], orders: new Map<number, OrderRow[]>() }));
vi.mock("@/stores/activeBetRunStore", async () => {
  const { defineStore } = await import("pinia");
  return { useActiveBetRunStore: defineStore("activeBetRunTest", { state: () => ({ visibleRuns: mocks.runs }),
    actions: { legStatusLabel: () => "旧腿状态", legPlacementLabel: () => "旧编排状态" } }) };
});
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: () => undefined }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ isLoggedIn: true, userId: "owner", config: { makeUp: false } }) }));
vi.mock("@/stores/orderObservationStore", () => ({ useOrderObservationStore: () => ({ forLink: () => [], truncatedOwners: [] }) }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => ({ orders: mocks.orders }) }));
vi.mock("@/components/platform/PlatformIcon.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/order/OrderExecutionTimeline.vue", () => ({ default: { render: () => null } }));

function record() {
  const row = createGtcExecution("g", "owner", "wallet", "maker", { linkId: 1791627407669, betRowId: 1, matchId: 2,
    originalPmLeg: "B", target: "Away", otherTarget: "Home", otherProvider: "RAY", playerId: 11, otherPlayerId: 12,
    otherOdds: 1.74, shares: "25.97" } as GtcPlan, 1000);
  Object.assign(row, { pmAuthorized: true, submit: "accepted", orderId: "pm", decision: "closed", manual: true,
    matched: "25.97", open: "0", complete: true, terminal: true, observedAt: 36000 });
  row.other.state = "filled"; row.other.orderId = "ray";
  return row;
}
async function panel() {
  const app = createSSRApp(ActiveBetRunView); app.use(createPinia());
  const context: { teleports?: Record<string, string> } = {};
  await renderToString(app, context);
  return context.teleports?.body || "";
}
beforeEach(() => {
  mocks.runs = [{ betId: 1, matchId: 2, linkId: 1791627407669, mode: "arb", matchTitle: "FaZe vs NAVI", betName: "地图1获胜",
    phase: "syncing", overallLabel: "旧编排结果", terminalAt: 35000, startedAt: 1000, updatedAt: 35000, events: [],
    legs: [{ side: "A", platform: "RAY", target: "Home", status: "confirmed", events: [] },
      { side: "B", platform: "Polymarket", target: "Away", status: "confirmed", events: [] }] }];
  gtcProgress.owner = "owner"; gtcProgress.records = [record()]; gtcProgress.queryIssues = {};
  gtcProgress.otherQueryIssues = {};
  mocks.orders.clear();
});
describe("实时浮窗接入 GTC 原单状态", () => {
  it("uses current GTC status throughout summary, comparison and final orchestration after the local run ends", async () => {
    const html = await panel();
    expect(html).toContain("双边套利 · PM GTC");
    expect(html).toContain("GTC · 全部成交");
    expect(html).toContain("原单已确认");
    expect(html).toContain("成交 25.97 / 25.97 份；挂单 0 份");
    expect(html).toMatch(/active-bet-run__flow-step--done[^>]*>[\s\S]*?提交下注/);
    expect(html).not.toMatch(/旧编排结果|旧腿状态|旧编排状态|缺少场馆确认记录|提交记录缺失/);
    Object.assign(gtcProgress.records[0]!, { matched: "5", open: "20.97", terminal: false });
    expect(await panel()).toContain("部分成交挂单中");
  });
  it("does not expose another owner's GTC state and retains FOK rendering without an exact GTC match", async () => {
    gtcProgress.owner = "foreign";
    const html = await panel();
    expect(html).toContain("旧编排结果");
    expect(html).not.toContain("GTC · 全部成交");
    expect(html).not.toContain("PM GTC");
  });
  it("updates the card, detailed summary, comparison and closing hint for a late rejection", async () => {
    gtcProgress.records[0]!.groupComplete = true;
    mocks.orders.set(1791627407669, [{ OrderID: "ray", Link: 1791627407669, PlayerID: 12, Type: "RAY", Status: "Reject", PmGtcExecutionId: "g" }]);
    const html = await panel();
    expect(html).toContain("原单拒单");
    expect(html).toContain("本组需重新核查");
    expect(html).toContain("原单出现拒单或退回，请核查本组订单");
    expect(html).not.toContain("本组已完成");
    expect(html).not.toContain("RAY 原单已确认");
    expect(html).toContain("active-bet-run__col--danger");
    expect(html).toContain("active-bet-run__flow-step--danger");
    expect(gtcProgress.records[0]!.other.state).toBe("filled");
  });
  it("shows each leg's query error without overwriting confirmed order facts", async () => {
    gtcProgress.queryIssues.g = { kind: "query", message: "PM查询暂不可用", at: 37000 };
    gtcProgress.otherQueryIssues.g = { kind: "query", message: "RAY查询暂不可用", at: 37000 };
    const html = await panel();
    expect(html).toContain("PM查询暂不可用");
    expect(html).toContain("RAY查询暂不可用");
    expect(html).toContain("GTC · 全部成交");
    expect(html).toContain("原单已确认");
  });
});
