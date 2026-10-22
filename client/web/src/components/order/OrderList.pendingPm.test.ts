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
  expect(html).toContain("PmPending");
  expect(text).not.toContain("份额：");
  expect(text).not.toContain("成交价：");
  expect(text).not.toContain("卖出");
});

it("does not include a Pending order in profit or exposure preview", () => {
  expect(polymarketMoneyForAggregate(pending, [pending])).toBe(0);
  expect(orderLinkLegend([pending])).toBe("订单待确认");
  expect(pmOrderSharesText(pending)).toBeNull();
  expect(pmOrderFillPriceText(pending)).toBeNull();
  expect(resolvePmOrderListStatusClass(pending)).toBe("PmPending");
  expect(resolvePmOrderListStatusClass({ ...pending, Status: "None" })).toBe("None");
});
