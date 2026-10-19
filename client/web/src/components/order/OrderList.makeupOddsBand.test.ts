import { renderToString } from "@vue/server-renderer";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import OrderList from "./OrderList.vue";
import { LoseOrder } from "@/models/loseOrder";
import { loseOrderToPendingRow } from "@/shared/orderLink";
import type { MakeupOddsBandPrefs } from "@/types/extensionPrefs";
import type { OrderRow } from "@/types/order";

const prefs: MakeupOddsBandPrefs = { enabled: true, upper: 1.02, lower: 0.96 };
const order = new LoseOrder({ betId: 42, linkId: 123, betMoney: 54, betOdds: 3.01 });

async function renderRow(row: OrderRow) {
  const app = createSSRApp(OrderList, { orderEntries: [[123, [row]]] });
  app.use(createPinia());
  const html = await renderToString(app);
  return { html, text: html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ") };
}

describe("OrderList makeup odds band", () => {
  it("renders screenshot odds with the actual factor boundaries", async () => {
    const { text } = await renderRow(loseOrderToPendingRow(order, 1.01, prefs));
    expect(text).toContain("打平赔率：1.498");
    expect(text).toContain("下沿赔率：1.438");
    expect(text).toContain("上沿赔率：1.528");
  });

  it("shows disabled lower bound and distinguishes approximate profit-rate odds", async () => {
    const disabled = await renderRow(loseOrderToPendingRow(order, 1.01, { ...prefs, lower: 0 }));
    expect(disabled.text).toContain("下沿赔率：已关闭");
    const profit = await renderRow(loseOrderToPendingRow(order, 1.01, {
      ...prefs, mode: "profitRate", upperProfitPct: 4, lowerLossPct: 3,
    }));
    expect(profit.text).toMatch(/下沿赔率：约 \d/);
    expect(profit.text).toMatch(/上沿赔率：约 \d/);
    expect(profit.html).toContain("实际按取整后的补单金额计算总体保底利润率");
  });

  it("keeps manual, disabled and real orders free of band labels", async () => {
    for (const row of [
      loseOrderToPendingRow(order, 1.01, { ...prefs, enabled: false }),
      loseOrderToPendingRow(new LoseOrder({ ...order.toJSON(), isCreateOrder: true }), 1.01, prefs),
      { OrderID: "real-1", Type: "RAY", Odds: 3.01, BetMoney: 54, Status: "None" } satisfies OrderRow,
    ]) {
      const { text } = await renderRow(row);
      expect(text).not.toContain("打平赔率");
      expect(text).not.toContain("下沿赔率");
      expect(text).not.toContain("上沿赔率");
    }
  });
});
