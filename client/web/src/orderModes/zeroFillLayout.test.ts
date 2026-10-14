import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { OrderRow } from "@/types/order";
import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { renderToString } from "@vue/server-renderer";
import { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } from "element-plus";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { gtcProgress } from "./gtc/gtcProgressState";
import OrderHost from "./OrderHost.vue";

vi.mock("./gtc/displayRecords", async () => {
  const { computed, ref } = await import("vue");
  const { gtcProgress } = await import("./gtc/gtcProgressState");
  return { useGtcDisplayRecords: (enabled: () => boolean) => ({ records: computed(() => enabled() ? gtcProgress.records : []), error: ref("") }) };
});
vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus/es/components/select/style/css", () => ({}));
vi.mock("element-plus/es/components/option/style/css", () => ({}));
vi.mock("@/components/order/OrderDateNav.vue", () => ({ default: { render: () => h("span", "日期控件") } }));
vi.mock("@/components/order/LoseOrderView.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/order/OrderMakeupStatusBar.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/order/RayLinkMonitorCard.vue", () => ({ default: { render: () => null } }));
const date = "2026-10-11";
const now = new Date(`${date}T10:00:00+08:00`).getTime();
const zero = () => ({ ...createGtcExecution("zero", "1", "wallet", "maker", { playerId: 1, shares: "10", price: "0.5", linkId: -now,
  orderHash: "zero-original", match: "zero-original-match", bet: "Full", item: "Home" } as GtcPlan, now),
  submit: "accepted" as const, pmAuthorized: true, orderId: "zero-original", open: "10",
  order: { id: "zero-original", original: "10", matched: "0", status: "LIVE", tradeIds: [] } });
async function render(embedded = false, rows?: OrderRow[]) {
  const pinia = createPinia(); setActivePinia(pinia);
  const orders = useOrderStore(); orders.orderDate = date;
  const financial: OrderRow = { OrderID: "fok", Type: "RAY", PlayerID: 2, Link: now + 1000, CreateAt: now,
    Match: "financial-fok-match", Bet: "Full", Item: "Away", BetMoney: 50, Odds: 2, Status: "None" };
  financial.Link = -now;
  orders.orders = new Map([[-now, rows ?? [financial]]]);
  useUserStore().userId = 1;
  const before = JSON.stringify([...orders.orders]);
  const app = createSSRApp({ render: () => h(OrderHost, { embedded }) }).use(pinia);
  app.provide(ID_INJECTION_KEY, { prefix: 100, current: 0 });
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 });
  const html = await renderToString(app);
  expect(JSON.stringify([...orders.orders])).toBe(before);
  return html;
}
beforeEach(() => { gtcProgress.owner = "1"; gtcProgress.records = [zero()]; gtcProgress.error = ""; });
it("renders the zero-fill original once in the ordinary list and the same Link group as its other leg", async () => {
  const positive = { ...zero(), id: "positive", matched: "1", orderId: "positive-original", plan: { ...zero().plan, linkId: -(now - 1000), match: "legacy-positive-match" } };
  gtcProgress.records.push(positive);
  const html = await render();
  expect(html.indexOf("order-date-bar")).toBeLessThan(html.indexOf('class="orders"'));
  expect(html.indexOf('class="orders"')).toBeLessThan(html.indexOf("zero-original-match"));
  expect(html.indexOf("financial-fok-match")).toBeLessThan(html.indexOf("legacy-positive-match"));
  expect(html.match(/data-execution-id="zero"/g)).toHaveLength(1);
  expect(html.match(new RegExp(`data-link-id="${-now}"`, "g"))).toHaveLength(1);
  expect(html.match(/class="orders"/g)).toHaveLength(1);
  expect(html).not.toContain("零成交 GTC 订单");
  expect(html).not.toContain("尚未入库的 GTC 挂单");
});
it("leaves ordinary FOK rows alone when there is no zero-fill execution", async () => {
  gtcProgress.records = []; const html = await render();
  expect(html).toContain("financial-fok-match"); expect(html).not.toContain("零成交 GTC 订单"); expect(html).not.toContain("GTC ·");
});
it("does not add current-user zero-fill cards to an embedded account view", async () => {
  const html = await render(true); expect(html).toContain("financial-fok-match"); expect(html).not.toContain("zero-original-match");
});
it("never adds a different user's execution beside the ordinary FOK rows", async () => {
  gtcProgress.owner = "foreign";
  gtcProgress.records = [{ ...zero(), owner: "foreign" }];
  const html = await render();
  expect(html).toContain("financial-fok-match");
  expect(html).not.toContain("zero-original-match");
});
