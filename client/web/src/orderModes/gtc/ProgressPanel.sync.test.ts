import { afterEach, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import type { GtcPlan } from "@changmen/shared/pm_gtc";
import ProgressPanel from "./ProgressPanel.vue";
import { gtcProgress } from "./gtcProgressState";
vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));

const execution = () => ({ ...createGtcExecution("own", "owner", "wallet", "maker", { shares: "1" } as GtcPlan, 1),
  submit: "accepted" as const, terminal: true, complete: true, matched: "1", open: "0", observedAt: 10,
  order: { id: "order", original: "1", matched: "1", status: "MATCHED", tradeIds: ["trade"] },
  fills: { trade: { key: "trade", tradeId: "trade", bucket: "maker", role: "MAKER" as const, shares: "1", price: "0.5", fee: "0", status: "CONFIRMED" as const, updatedAt: 1 } } });
const render = (row = execution()) => renderToString(createSSRApp({ render: () => h(ProgressPanel, { execution: row }) }));
afterEach(() => { gtcProgress.queryIssues = {}; gtcProgress.recoveredAt = 0; });
it("a synchronization failure keeps confirmed status visible and disappears once the successful retry clears it", async () => {
  gtcProgress.queryIssues.own = { kind: "auth", message: "登录服务暂时不可用，请稍后重试", at: 20 };
  let html = await render();
  expect(html).toContain("全部成交"); expect(html).toContain("同步提示：登录服务");
  expect(html).toContain("已确认订单记录保留"); expect(html).not.toContain("明确拒单");
  delete gtcProgress.queryIssues.own;
  html = await render(); expect(html).not.toContain("同步提示"); expect(html).toContain("已停止挂单查询");
});
it("an old persisted login-service error is suppressed after the authenticated history request succeeds", async () => {
  const row = { ...execution(), error: "登录服务暂时不可用，请稍后重试" };
  expect(await render(row)).toContain("同步提示：登录服务");
  gtcProgress.recoveredAt = 30;
  expect(await render(row)).not.toContain("登录服务");
});
it("genuine conflicting trade evidence remains an order verification problem", async () => {
  const row = { ...execution(), error: "同一成交明细数量或价格冲突" };
  expect(await render(row)).toContain(row.error);
});
