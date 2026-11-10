import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import { computed, nextTick, reactive } from "vue";
import { mountComposable } from "@/test/mountComposable";
import { useOddsStore } from "@/stores/oddsStore";
import { useSportOddsStore } from "@/stores/sportOddsStore";
import type { OrderRow } from "@/types/order";
import { useOrderListLiveQuotes } from "./useOrderListLiveQuotes";
import { __testPushPolymarketMarketQuote as pushQuote, __testResetPolymarketMarketQuoteHub as resetQuotes,
  registerPolymarketQuoteAssets, unregisterPolymarketQuoteConsumer } from "@changmen/venue-browser/polymarket";
import * as pmWs from "@changmen/venue-browser/polymarket/ws";

const mounted: Array<{ unmount: () => void }> = [];
const send = vi.fn(), stop = vi.fn();
beforeEach(() => {
  send.mockClear(); stop.mockClear();
  vi.spyOn(pmWs, "startPolymarketMarketWs").mockReturnValue({ send, stop });
});
afterEach(() => {
  for (const app of mounted.splice(0)) app.unmount();
  resetQuotes(); vi.restoreAllMocks(); vi.useRealTimers();
});
const pm: OrderRow = { Type: "Polymarket", PmSide: "buy", Status: "None", PmTokenId: "pm-token",
  PmShares: 20, PmStakeUsdc: 10, PmFillPrice: 0.5 };
function setup(rows: OrderRow[] = [pm]) {
  const props = reactive({ orderEntries: [[123, rows]] as Array<[number, OrderRow[]]> });
  const pinia = createPinia();
  const app = mountComposable(() => useOrderListLiveQuotes(props), pinia); mounted.push(app);
  return { ...app, props, c: app.value, odds: useOddsStore(pinia), sports: useSportOddsStore(pinia) };
}
function quote(id: string, price: number) { return { id, odds: 1 / price, clobPrice: price, isLock: false, time: 1791558222471 }; }

it("subscribes only held PM buy tokens, including price-derived Win/Lose and partial fills, with deduplication", () => {
  setup([
    pm, { ...pm, OrderID: "another-buy" },
    { ...pm, PmTokenId: "winner", Status: "Win", PmMatchResult: "Win" },
    { ...pm, PmTokenId: "loser", Status: "Lose", PmMatchResult: "Lose" },
    { ...pm, PmTokenId: "partial", PmSellState: "partial", PmAttributedSellShares: 10 },
    ...["Pending", "Reject", "Return"].map(Status => ({ ...pm, PmTokenId: Status, Status })),
    { ...pm, PmTokenId: "settled", PmSellState: "settled" },
    { ...pm, PmTokenId: "closed", PmSellState: "closed" },
    { ...pm, PmTokenId: "sold", PmAttributedSellShares: 20 },
    { ...pm, PmTokenId: "dust", PmAttributedSellShares: 19.99 },
    { ...pm, PmTokenId: "unfilled", PmShares: 0 },
    { ...pm, PmTokenId: "sell", PmSide: "sell" },
    { ...pm, PmTokenId: "" },
    { Type: "PredictFun", Status: "None", PfTokenId: "pf", PfShares: 20 },
  ]);
  expect(JSON.parse(send.mock.calls.at(-1)![0]).assets_ids).toEqual(["pm-token", "winner", "loser", "partial"]);
});

it("keeps a quiet 0.99 bid after the match consumer leaves and restores it from a reconnect snapshot", async () => {
  vi.useFakeTimers();
  registerPolymarketQuoteAssets("esport", ["pm-token"]);
  const row = { ...pm, Status: "Win", PmMatchResult: "Win" as const };
  const before = JSON.stringify(row);
  const { c, odds } = setup([row]);
  const save = vi.spyOn(odds, "save");
  const opts = vi.mocked(pmWs.startPolymarketMarketWs).mock.calls[0]![0];
  const book = JSON.stringify({ event_type: "book", asset_id: "pm-token", bids: [{ price: "0.99", size: "100" }], asks: [] });
  const price = computed(() => c.pmLivePriceText(row));
  opts.onMessage(book);
  expect(price.value).toBe("0.99");
  unregisterPolymarketQuoteConsumer("esport");
  await vi.advanceTimersByTimeAsync(4 * 3600_000);
  expect(price.value).toBe("0.99");
  expect(stop).not.toHaveBeenCalled();
  opts.onDisconnect?.();
  expect(price.value).toBe("—");
  opts.onOpen("changmen");
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toMatchObject({ assets_ids: ["pm-token"], initial_dump: true });
  opts.onMessage(book);
  expect(price.value).toBe("0.99");
  expect(save).not.toHaveBeenCalled();
  expect(JSON.stringify(row)).toBe(before);
});

it("requests a snapshot for newly loaded tokens and releases sold or settled holdings without resubscribing unchanged sets", async () => {
  registerPolymarketQuoteAssets("esport", ["match-token"]);
  const { props } = setup();
  props.orderEntries[0]![1].push({ ...pm, PmTokenId: "new-token", Status: "Win" });
  await nextTick();
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toMatchObject({
    assets_ids: ["match-token", "pm-token", "new-token"], initial_dump: true,
  });
  send.mockClear();
  props.orderEntries = [[123, props.orderEntries[0]![1].map(row => ({ ...row, Money: 99 }))]];
  await nextTick();
  expect(send).not.toHaveBeenCalled();
  props.orderEntries[0]![1][0]!.PmSellState = "settled";
  await nextTick();
  expect(JSON.parse(send.mock.calls.at(-1)![0])).toMatchObject({ assets_ids: ["match-token", "new-token"], initial_dump: false });
  props.orderEntries[0]![1][1]!.PmAttributedSellShares = 20;
  await nextTick();
  expect(JSON.parse(send.mock.calls.at(-1)![0]).assets_ids).toEqual(["match-token"]);
  expect(stop).not.toHaveBeenCalled();
});

it("isolates multiple order lists and releases their subscriptions on unmount", () => {
  const first = setup();
  const second = setup([{ ...pm, PmTokenId: "second-token" }]);
  expect(JSON.parse(send.mock.calls.at(-1)![0]).assets_ids).toEqual(["pm-token", "second-token"]);
  first.unmount();
  expect(JSON.parse(send.mock.calls.at(-1)![0]).assets_ids).toEqual(["second-token"]);
  expect(stop).not.toHaveBeenCalled();
  second.unmount(); mounted.splice(0);
  expect(stop).toHaveBeenCalledTimes(1);
});

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
