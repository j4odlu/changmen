import { renderToString } from "@vue/server-renderer";
import { createPinia } from "pinia";
import { createSSRApp, h } from "vue";
import { expect, it } from "vitest";
import type { OrderRow } from "@/types/order";
import OrderList from "./OrderList.vue";

it("preserves rich text, labels and row/group extension slots after presentation extraction", async () => {
  const row: OrderRow = { OrderID: "ob", Type: "OB", Link: 1791558222471,
    Match: "<b>A vs B</b>", Bet: "<i>地图2</i>", Item: "A", Status: "Win", Money: 100, BetMoney: 100, Odds: 2 };
  const app = createSSRApp({ render: () => h(OrderList, { orderEntries: [[row.Link!, [row]]] }, {
    "row-actions": ({ row: actionRow }: { row: OrderRow }) => h("button", `诊断-${actionRow.OrderID}`),
    "group-actions": ({ link }: { link: number }) => h("button", `删除组-${link}`),
    "group-monitor": () => h("span", "监控"),
  }) });
  app.use(createPinia());
  const html = await renderToString(app), text = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  expect(html).toContain("<b>A vs B</b>"); expect(html).toContain("<i>地图2</i>");
  expect(text).toContain("诊断-ob"); expect(text).toContain("删除组-1791558222471"); expect(text).toContain("监控");
  expect(text).toContain("买入金额：100 赔率："); expect(text).toContain("盈亏：100");
});
it("keeps PF labels as plain text and PM buy/sell attachment tags intact", async () => {
  const pf: OrderRow = { OrderID: "pf", Type: "PredictFun", Match: "A < B", Bet: "地图2", Item: "B", Status: "Win", Money: 10 };
  const buy: OrderRow = { OrderID: "pm", Type: "Polymarket", PmSide: "buy", PmShares: 20, PmStakeUsdc: 10,
    PmFillPrice: 0.5, Status: "None", BetMoney: 72 };
  const sell: OrderRow = { ...buy, OrderID: "sell", PmSide: "sell", PmBuyOrderId: "pm" };
  const app = createSSRApp(OrderList, { orderEntries: [[1791558222471, [pf, buy, sell]]] });
  app.use(createPinia());
  const html = await renderToString(app);
  expect(html).toContain("A &lt; B"); expect(html).toContain("order--sell-attach");
  expect(html).toContain("order__pm-tag--buy"); expect(html).toContain("order__pm-tag--sell");
  expect(html).toContain("卖出记录");
});
