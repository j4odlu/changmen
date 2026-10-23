import { renderToString } from "@vue/server-renderer";
import { createPinia } from "pinia";
import { expect, it } from "vitest";
import { createSSRApp } from "vue";
import OrderList from "./OrderList.vue";
import { orderLinkLegend, polymarketMoneyForAggregate } from "@/shared/orderLink";
import { pmOrderSharesText, pmOrderFillPriceText, resolvePmOrderListStatusClass } from "@/shared/pmOrderDisplay";
import type { OrderRow } from "@/types/order";

const pending: OrderRow = { OrderID: "same-order", Type: "Polymarket", PmSide: "buy", Status: "Pending",
  Match: "Team Liquid vs 1w Team", Bet: "[地图2] 获胜", Item: "Team Liquid", BetMoney: 100.031,
  Money: 999, Odds: 1.515, PmSubmittedPrice: 0.66, PmTokenId: "token", Link: 123 };

it("shows the stored Pending order with its full labels, requested amount and a confirmation badge", async () => {
  const app = createSSRApp(OrderList, { orderEntries: [[123, [pending]]] });
  app.use(createPinia());
  const html = await renderToString(app);
  const text = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  expect(text).toContain(pending.Match);
  expect(text).toContain(pending.Bet);
  expect(text).toContain("申请金额：100");
  expect(text).toContain("盈亏：待确认");
  expect(text).toContain("提交限价：0.66");
  expect(text).toContain("赔率：1.515");
  expect(text).not.toContain("1.515 /");
  expect(html).toContain("PmPending");
  expect(text).not.toContain("份额：");
  expect(text).not.toContain("成交价：");
  expect(text).not.toContain("卖出");
});

it("shows submitted and filled odds independently on filled PM buys", async () => {
  const row: OrderRow = { ...pending, Status: "None", Odds: 1.5, PmFillPrice: 0.6, PmShares: 10, PmStakeUsdc: 6 };
  const app = createSSRApp(OrderList, { orderEntries: [[123, [row]]] });
  app.use(createPinia());
  const text = (await renderToString(app)).replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  expect(text).toContain("买入价：0.6");
  expect(text).toContain("赔率：1.500 / 1.666");
});

it.each(["Pending", "Reject"])("preserves the submitted-price quote for %s rows without saved odds", async Status => {
  const row: OrderRow = { ...pending, Status, Odds: undefined, PmSubmittedPrice: 0.5, PmFillPrice: 0.4 };
  const app = createSSRApp(OrderList, { orderEntries: [[123, [row]]] });
  app.use(createPinia());
  const text = (await renderToString(app)).replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  expect(text).toContain("提交限价：0.5");
  expect(text).toContain("赔率：2.000");
  expect(text).not.toContain("2.000 /");
});

it("shows only submitted odds while the fill price is missing", async () => {
  const app = createSSRApp(OrderList, { orderEntries: [[123, [{ ...pending, Status: "None" }]]] });
  app.use(createPinia());
  const text = (await renderToString(app)).replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  expect(text).toContain("赔率：1.515");
  expect(text).not.toContain("1.515 /");
});

it("does not repeat the odds when submission and fill have the same display value", async () => {
  const row: OrderRow = { ...pending, Status: "None", Odds: 2, PmFillPrice: 0.5, PmShares: 10, PmStakeUsdc: 5 };
  const app = createSSRApp(OrderList, { orderEntries: [[123, [row]]] });
  app.use(createPinia());
  const text = (await renderToString(app)).replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  expect(text).toContain("赔率：2.000");
  expect(text).not.toContain("2.000 /");
});

it("does not include a Pending order in profit or exposure preview", () => {
  expect(polymarketMoneyForAggregate(pending, [pending])).toBe(0);
  expect(orderLinkLegend([pending])).toBe("订单待确认");
  expect(pmOrderSharesText(pending)).toBeNull();
  expect(pmOrderFillPriceText(pending)).toBeNull();
  expect(resolvePmOrderListStatusClass(pending)).toBe("PmPending");
  expect(resolvePmOrderListStatusClass({ ...pending, Status: "None" })).toBe("None");
});
