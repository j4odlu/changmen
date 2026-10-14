import type { GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { gtcOrderCardView } from "./orderCardView";
import ProgressPanel from "./ProgressPanel.vue";

vi.mock("element-plus", () => ({ ElMessage: { error: vi.fn() }, ElMessageBox: { confirm: vi.fn() }, ElButton: { render: () => null } }));
vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));

function execution(): GtcExecution {
  const row = createGtcExecution("original", "owner", "wallet", "maker", { playerId: 1, shares: "10", price: "0.6" } as GtcPlan, 1);
  row.pmAuthorized = true; row.submit = "accepted"; row.orderId = "order";
  return mergeGtcFacts(row, {
    order: { id: "order", original: "10", matched: "4", status: "LIVE", tradeIds: ["trade"] },
    fills: [{ key: "trade", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "4", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1000 }],
    complete: true, observedAt: 1000,
  });
}
const render = (row: GtcExecution) => renderToString(createSSRApp({ render: () => h(ProgressPanel, { execution: row }) }));

it("splits mixed fills by role with six-decimal precision and excludes failed fills", async () => {
  const row = execution();
  row.fills.trade!.shares = "2.765433";
  row.fills.taker = { ...row.fills.trade!, key: "taker", tradeId: "taker", bucket: "taker", role: "TAKER", shares: "1.234567", status: "MINED" };
  row.fills.failed = { ...row.fills.taker, key: "failed", tradeId: "failed", shares: "9", status: "FAILED" };
  const html = await render(row);
  expect(gtcOrderCardView(row)).toMatchObject({ takerShares: "1.234567", makerShares: "2.765433" });
  expect(html).toMatch(/<dt[^>]*>TAKER<\/dt><dd[^>]*>1\.234567 份<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>MAKER<\/dt><dd[^>]*>2\.765433 份<\/dd>/);
  expect(html).toContain("4 / 10 份"); expect(html).toContain("成交待确认");
  expect([...html.matchAll(/<dt[^>]*>(.*?)<\/dt>/g)].map(match => match[1])).toEqual(["成交", "挂单", "TAKER", "限价", "MAKER", "均价"]);
});
it("shows zero for an absent role and keeps an incomplete breakdown pending verification", async () => {
  const row = execution();
  expect(gtcOrderCardView(row)).toMatchObject({ takerShares: "0", makerShares: "4" });
  row.fills = {};
  expect(gtcOrderCardView(row)).toMatchObject({ takerShares: null, makerShares: null });
  const html = await render(row);
  expect(html).toMatch(/<dt[^>]*>TAKER<\/dt><dd[^>]*>待核实<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>MAKER<\/dt><dd[^>]*>待核实<\/dd>/);
  expect(html).toContain("4 / 10 份");
});
