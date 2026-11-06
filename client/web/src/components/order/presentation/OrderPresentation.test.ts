import { renderToString } from "@vue/server-renderer";
import { createSSRApp, h } from "vue";
import { expect, it } from "vitest";
import OrderQuoteLine from "./OrderQuoteLine.vue";
import OrderMarketDetails from "./OrderMarketDetails.vue";
import OrderStatusBadge from "./OrderStatusBadge.vue";
import OrderTag from "./OrderTag.vue";
import OrderLiveQuoteLine from "./OrderLiveQuoteLine.vue";
const text = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

it("keeps shares, price and both submitted/filled odds supplied by the controller", async () => {
  const html = await renderToString(createSSRApp(OrderQuoteLine, { sharesText: "20", priceLabel: "买入价",
    priceText: "0.5", oddsText: "2.010 / 2.000", oddsTitle: "提交赔率 / 成交赔率", showOdds: true }));
  expect(text(html)).toBe("份额：20买入价：0.5赔率：2.010 / 2.000");
  expect(html).toContain('title="提交赔率 / 成交赔率"');
});
it("does not invent shares, price or odds when the controller hides them", async () => {
  const html = await renderToString(createSSRApp(OrderQuoteLine, { showOdds: false, oddsText: "2.000" }));
  expect(text(html)).toBe("");
});
it("keeps PF plain labels escaped and preserves the caller's rich-text slots", async () => {
  const plain = await renderToString(createSSRApp(OrderMarketDetails, { matchText: "A < B", betText: "地图2", itemText: "B" }));
  expect(plain).toContain("A &lt; B"); expect(text(plain)).toContain("地图2");
  const app = createSSRApp({ render: () => h(OrderMarketDetails, { itemText: "B" }, {
    match: () => h("div", { class: "match", innerHTML: "<b>A vs B</b>" }),
    bet: () => h("span", { innerHTML: "<i>地图2</i>" }),
  }) });
  const slotted = await renderToString(app);
  expect(slotted).toContain('<div class="match"><b>A vs B</b></div>');
  expect(slotted).toContain("<span><i>地图2</i></span>");
});
it.each(["Win", "Lose", "Return", "Pending", "PmClosing"])("renders the supplied %s badge without financial inference", async statusClass => {
  const html = await renderToString(createSSRApp(OrderStatusBadge, { statusClass }));
  expect(html).toContain(statusClass); expect(html).toContain("status");
});
it("preserves 50/50 labels and observation tags independently of status", async () => {
  const html = await renderToString(createSSRApp(OrderTag, { text: "50/50 已结算", title: "每份兑付 $0.50", className: "order__pm-tag--pe" }));
  expect(text(html)).toBe("50/50 已结算"); expect(html).toContain('title="每份兑付 $0.50"');
  expect(html).toContain("order__pm-tag--pe"); expect(html).not.toContain("status");
});
it("uses price/odds visibility flags without falling back to a buy price", async () => {
  const missing = await renderToString(createSSRApp(OrderLiveQuoteLine, { showPrice: true, showOdds: false, priceText: "—", oddsText: "2.000" }));
  expect(text(missing)).toBe("当前价：—");
  const live = await renderToString(createSSRApp(OrderLiveQuoteLine, { showPrice: true, showOdds: true, priceText: "0.6", oddsText: "1.666" }));
  expect(text(live)).toBe("当前价：0.6当前赔率：1.666");
});
