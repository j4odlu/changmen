import { renderToString } from "@vue/server-renderer";
import { createPinia } from "pinia";
import { createSSRApp, h } from "vue";
import { afterEach, expect, it } from "vitest";
import { __testPushPolymarketMarketQuote as pushQuote, __testResetPolymarketMarketQuoteHub as resetQuotes } from "@changmen/venue-browser/polymarket";
import { Currency, getExchange } from "@changmen/shared/currency";
import { useOddsStore } from "@/stores/oddsStore";
import type { OrderRow } from "@/types/order";
import OrderList from "./OrderList.vue";
afterEach(() => resetQuotes());

async function render(row: OrderRow, customAmount = false, livePrice?: number) {
  const app = createSSRApp({ render: () => h(OrderList, { orderEntries: [[123, [row]]] },
    customAmount ? { "buy-amount": ({ row: slotRow }: { row: OrderRow }) => h("strong", `金额-${slotRow.OrderID}`) } : {}) });
  const pinia = createPinia(); app.use(pinia);
  if (livePrice != null) useOddsStore(pinia).save("Polymarket", {
    id: "token", odds: 1 / livePrice, clobPrice: livePrice, isLock: false, time: 1791558222471,
  });
  if (livePrice != null) pushQuote("token", 0.7, livePrice);
  const html = await renderToString(app);
  return { html, text: html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ") };
}
const pm: OrderRow = { OrderID: "pm-1", Type: "Polymarket", PmSide: "buy", PmTokenId: "token",
  Match: "potn9ki vs HellNight", Bet: "[地图2]获胜", Item: "HellNight", BetMoney: 72, Link: 123 };

it.each([["Win", 53], ["Lose", -72], ["Return", 0]] as const)("preserves PM 50/50 settlement with %s financial status", async (Status, Money) => {
  const { html, text } = await render({ ...pm, Status, Money, PmMatchResult: "EqualSplit", PmSellState: "settled" });
  expect(text).toContain("50/50 已结算");
  expect(text).toContain(`买入金额：72 盈亏：${Money}`);
  expect(html.match(/<label class="([^"]+)"/)![1]!.split(" ")).toEqual(expect.arrayContaining(["status", Status]));
  expect(html).not.toContain("order__live-pnl");
});
it("preserves PM custom amount slots and pending confirmation", async () => {
  const { text } = await render({ ...pm, Status: "Pending", Money: -999 }, true);
  expect(text).toContain("申请金额：金额-pm-1 盈亏：待确认");
  expect(text).not.toContain("盈亏：-999");
});
it("preserves awaiting-settlement PM/PF rows and PF currency conversion", async () => {
  expect((await render({ ...pm, Status: "None" })).text).toContain("盈亏：待结算");
  const pf: OrderRow = { ...pm, Type: "PredictFun", PfSide: "buy", PfSellState: "settled", Status: "Win", Money: 10, BetMoney: 20 };
  const { text } = await render(pf);
  expect(text).toContain(`买入金额：${Math.round(20 * getExchange(Currency.USDT))} 盈亏：${Math.round(10 * getExchange(Currency.USDT))}`);
  expect((await render({ ...pf, PfSellState: "open", Status: "None" })).text).toContain("盈亏：待结算");
});
it("keeps live P&L beside stake/profit while current price remains in its separate row", async () => {
  const { html } = await render({ ...pm, Status: "None", PmShares: 20, PmStakeUsdc: 10, PmFillPrice: 0.5 }, false, 0.6);
  const liveTag = html.match(/<span\b[^>]*class="[^"]*\border__live-pnl\b[^"]*"[^>]*>/)?.[0] ?? "";
  expect(liveTag).toMatch(/\bpos\b/);
  const liveIndex = html.indexOf(liveTag);
  const sellRowIndex = html.indexOf("order__profit-line--sell-row");
  expect(liveIndex).toBeGreaterThan(0);
  expect(sellRowIndex).toBeGreaterThan(liveIndex);
  expect(html.slice(sellRowIndex)).toContain("当前可卖价：0.6");
  expect(html.slice(sellRowIndex)).not.toContain("order__live-pnl");
});
