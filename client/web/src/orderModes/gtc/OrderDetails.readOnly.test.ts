import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { useOrderStore } from "@/stores/orderStore";
import { gtcProgress } from "./gtcProgressState";
import OrderDetails from "./OrderDetails.vue";
import { gtcPendingDisplayRows } from "./orderDisplayProjection";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
const now = new Date("2026-10-11T10:00:00+08:00").getTime();
const row = () => ({ ...createGtcExecution("zero", "owner", "wallet", "maker", { playerId: 1, shares: "10", price: "0.5",
  linkId: -now, orderHash: "original", match: "zero fill", bet: "Full", item: "Home" } as GtcPlan, now),
  submit: "accepted" as const, pmAuthorized: true, orderId: "original", revision: 2, open: "10",
  order: { id: "original", original: "10", matched: "0", status: "LIVE", tradeIds: [] } });
async function render(readonly = false) {
  const pinia = createPinia(); setActivePinia(pinia);
  useOrderStore().orders = new Map();
  const displayRow = gtcPendingDisplayRows([], [row()], "2026-10-11", 0)[0]!;
  const html = await renderToString(createSSRApp({ render: () => h(OrderDetails, { row: displayRow, records: [row()], readonly }) }).use(pinia));
  expect(useOrderStore().orders.size).toBe(0);
  return html;
}
beforeEach(() => { gtcProgress.owner = "owner"; gtcProgress.records = []; gtcProgress.error = ""; });
it("displays a read-only loaded zero-fill card with cancellation disabled until its executor has loaded it", async () => {
  const html = await render();
  expect(html).toContain("成交：0 / 10 份"); expect(html).toContain("取消PM挂单");
  expect(html).toMatch(/<button[^>]*\sdisabled(?:=""|="disabled")?(?:\s|>)/);
  expect(gtcProgress.records).toEqual([]);
});
it("preserves the existing cancellation button for the current executor's record", async () => {
  gtcProgress.records = [row()]; const html = await render();
  expect(html).toContain("取消PM挂单"); expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=""|="disabled")?(?:\s|>)/);
});
it.each(["foreign owner", "stale revision", "different account", "different original"])("never enables a control from a %s executor record", async (kind) => {
  if (kind === "foreign owner") { gtcProgress.owner = "foreign"; gtcProgress.records = [{ ...row(), owner: "foreign" }]; }
  else if (kind === "stale revision") { gtcProgress.records = [{ ...row(), revision: 1 }]; }
  else if (kind === "different account") { gtcProgress.records = [{ ...row(), plan: { ...row().plan, playerId: 2 } }]; }
  else { gtcProgress.records = [{ ...row(), orderId: "another", plan: { ...row().plan, orderHash: "another" } }]; }
  expect(await render()).toMatch(/<button[^>]*\sdisabled(?:=""|="disabled")?(?:\s|>)/);
});
it("keeps embedded read-only details from exposing runtime controls", async () => {
  gtcProgress.records = [row()]; const html = await render(true);
  expect(html).toContain("GTC"); expect(html).not.toContain("取消PM挂单");
});
