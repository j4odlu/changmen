import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { useOrderStore } from "@/stores/orderStore";
import { gtcProgress } from "./gtcProgressState";
import PendingOrders from "./PendingOrders.vue";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
const now = new Date("2026-10-11T10:00:00+08:00").getTime();
const row = () => ({ ...createGtcExecution("zero", "owner", "wallet", "maker", { playerId: 1, shares: "10", price: "0.5",
  linkId: -now, orderHash: "original", match: "zero fill", bet: "Full", item: "Home" } as GtcPlan, now),
  submit: "accepted" as const, pmAuthorized: true, orderId: "original", revision: 2, open: "10",
  order: { id: "original", original: "10", matched: "0", status: "LIVE", tradeIds: [] } });
async function render() {
  const pinia = createPinia(); setActivePinia(pinia);
  useOrderStore().orders = new Map();
  const html = await renderToString(createSSRApp({ render: () => h(PendingOrders, { date: "2026-10-11", accountId: 0, records: [row()] }) }).use(pinia));
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
it.each(["foreign owner", "stale revision"])("never enables a control from a %s executor record", async (kind) => {
  if (kind === "foreign owner") { gtcProgress.owner = "foreign"; gtcProgress.records = [{ ...row(), owner: "foreign" }]; }
  else { gtcProgress.records = [{ ...row(), revision: 1 }]; }
  expect(await render()).toMatch(/<button[^>]*\sdisabled(?:=""|="disabled")?(?:\s|>)/);
});
