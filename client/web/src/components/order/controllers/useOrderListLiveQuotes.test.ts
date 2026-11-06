import { afterEach, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import { computed, reactive } from "vue";
import { mountComposable } from "@/test/mountComposable";
import { useOddsStore } from "@/stores/oddsStore";
import { useSportOddsStore } from "@/stores/sportOddsStore";
import type { OrderRow } from "@/types/order";
import { useOrderListLiveQuotes } from "./useOrderListLiveQuotes";
import { __testPushPolymarketMarketQuote as pushQuote, __testResetPolymarketMarketQuoteHub as resetQuotes } from "@changmen/venue-browser/polymarket";

const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); resetQuotes(); vi.restoreAllMocks(); });
const pm: OrderRow = { Type: "Polymarket", PmSide: "buy", Status: "None", PmTokenId: "pm-token",
  PmShares: 20, PmStakeUsdc: 10, PmFillPrice: 0.5 };
function setup(rows: OrderRow[] = [pm]) {
  const props = reactive({ orderEntries: [[123, rows]] as Array<[number, OrderRow[]]> });
  const pinia = createPinia();
  const app = mountComposable(() => useOrderListLiveQuotes(props), pinia); mounted.push(app);
  return { ...app, props, c: app.value, odds: useOddsStore(pinia), sports: useSportOddsStore(pinia) };
}
function quote(id: string, price: number) { return { id, odds: 1 / price, clobPrice: price, isLock: false, time: 1791558222471 }; }

it("uses best bid for price/odds/P&L, never falls back to the buy ask", () => {
  const { c, odds, sports } = setup();
  expect(c.pmLivePriceText(pm)).toBe("—");
  expect(c.pmShowLivePrice(pm)).toBe(true);
  expect(c.pmShowLiveOdds(pm)).toBe(false);
  sports.save("Polymarket", "pm-token", 2);
  odds.save("Polymarket", quote("pm-token", 0.6));
  expect(c.pmLivePriceText(pm)).toBe("—");
  expect(c.pmLiveUnrealizedPnlCny(pm)).toBeNull();
  expect(c.pmLastLineOddsText(pm)).toBe("—");
  pushQuote("pm-token", 0.6, 0.48);
  const save = vi.spyOn(odds, "save");
  expect(c.pmLivePriceText(pm)).toBe("0.48");
  expect(c.pmShowLiveOdds(pm)).toBe(true);
  expect(c.pmLastLineOddsText(pm)).toBe("2.083");
  expect(c.pmLiveUnrealizedPnlCny(pm)).toBe(-3);
  expect(c.pmLiveUnrealizedPnlText(pm)).toBe("浮亏：-3");
  expect(save).not.toHaveBeenCalled();
  expect(sports.get("Polymarket", "pm-token")).toBe(2);
});
it("subscribes during setup, ignores unrelated tokens and follows list changes", () => {
  const { c, odds, props } = setup();
  // Creating a venue bucket is independently reactive; measure token updates after that.
  odds.save("Polymarket", quote("seed", 0.5));
  const read = vi.fn(() => c.pmLivePriceText(pm)), value = computed(read);
  expect(value.value).toBe("—");
  pushQuote("unrelated", 0.8, 0.7);
  expect(value.value).toBe("—");
  expect(read).toHaveBeenCalledTimes(1);
  pushQuote("pm-token", 0.7, 0.6);
  expect(value.value).toBe("0.6");
  expect(read).toHaveBeenCalledTimes(2);
  const other = { ...pm, PmTokenId: "next-token" };
  props.orderEntries = [[456, [other]]];
  pushQuote("next-token", 0.8, 0.7);
  expect(c.pmLivePriceText(other)).toBe("0.7");
});
it.each([
  { Status: "Pending" }, { Status: "Reject" }, { Status: "Return" }, { PmSide: "sell" },
  { PmSellState: "settled" }, { PmSellState: "closed" },
] as const)("keeps PM non-sellable lifecycle price visibility: %j", fields => {
  const { c } = setup();
  expect(c.pmShowLivePrice({ ...pm, ...fields })).toBe(false);
});
it("keeps partial holdings, PF quotes and display-only amount rules", () => {
  const pf: OrderRow = { Type: "PredictFun", PfSide: "buy", Status: "None", PfTokenId: "pf-token", PfShares: 20, PfNotionalUsdt: 10 };
  const { c, odds } = setup([pm, pf]);
  expect(c.pmShowLivePrice({ ...pm, PmSellState: "partial" })).toBe(true);
  expect(c.pmLiveUnrealizedPnlCny({ ...pm, DisplayOnly: true, BetMoney: undefined })).toBeNull();
  odds.save("PredictFun", quote("pf-token", 0.4));
  expect(c.pfLivePriceText(pf)).toBe("0.4");
  expect(c.pfShowLiveOdds(pf)).toBe(true);
  expect(c.pfLiveUnrealizedPnlCny(pf)).toBeLessThan(0);
  expect(c.pfShowLivePrice({ ...pf, PfSellState: "closed" })).toBe(false);
  expect(c.pfShowLivePrice({ ...pf, PfSellState: "settled" })).toBe(false);
});
it("unmount releases both subscriptions, including after-action callbacks", () => {
  const { c, odds, sports, unmount } = setup();
  // Isolate the controller's action subscriptions from the stores' direct reactivity.
  const snapshot = new Map<string, ReturnType<typeof quote>>();
  vi.spyOn(odds, "getEntry").mockImplementation((_platform, id) => snapshot.get(id));
  vi.spyOn(sports, "get").mockReturnValue(0);
  const read = vi.fn(() => c.pmLivePriceText(pm)), value = computed(read);
  expect(value.value).toBe("—");
  unmount(); mounted.pop();
  snapshot.set("pm-token", quote("pm-token", 0.6));
  pushQuote("pm-token", 0.7, 0.6);
  odds.save("Polymarket", quote("pm-token", 0.6));
  sports.save("Polymarket", "pm-token", 2);
  expect(value.value).toBe("—");
  expect(read).toHaveBeenCalledTimes(1);
});

it("clears bid-derived P&L when the book empties or the connection stops", () => {
  const { c } = setup();
  pushQuote("pm-token", 0.65, 0.6);
  expect(c.pmLiveUnrealizedPnlCny(pm)).toBe(13);
  pushQuote("pm-token", 0.65, null);
  expect(c.pmLivePriceText(pm)).toBe("—");
  expect(c.pmLiveUnrealizedPnlText(pm)).toBeNull();
  pushQuote("pm-token", 0.65, 0.6);
  resetQuotes();
  expect(c.pmLivePriceText(pm)).toBe("—");
});
