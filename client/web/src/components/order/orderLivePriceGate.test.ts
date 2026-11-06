import { afterEach, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import { computed, reactive } from "vue";
import { mountComposable } from "@/test/mountComposable";
import { useOddsStore } from "@/stores/oddsStore";
import { useSportOddsStore } from "@/stores/sportOddsStore";
import type { OrderRow } from "@/types/order";
import { useOrderListLiveQuotes } from "./controllers/useOrderListLiveQuotes";

// Exercise the actual subscription controller, without a copied implementation.
const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); vi.restoreAllMocks(); });
const pm: OrderRow = { Type: "Polymarket", PmTokenId: "tok-order", Status: "None" };
const pf: OrderRow = { Type: "PredictFun", PfTokenId: "pf-tok", Status: "None" };
function setup() {
  const pinia = createPinia(), props = reactive({ orderEntries: [[1, [pm, pf]]] as Array<[number, OrderRow[]]> });
  const app = mountComposable(() => useOrderListLiveQuotes(props), pinia); mounted.push(app);
  const odds = useOddsStore(pinia), sport = useSportOddsStore(pinia);
  // Prevent direct cache dependencies from masking the action subscription under test.
  vi.spyOn(odds, "getEntry").mockReturnValue(undefined);
  vi.spyOn(sport, "get").mockReturnValue(0);
  const read = vi.fn(() => `${app.value.pmLivePriceText(pm)} / ${app.value.pfLivePriceText(pf)}`), value = computed(read);
  expect(value.value).toBe("— / —");
  return { odds, sport, props, read, value };
}
const entry = (id: string) => ({ id, odds: 2, clobPrice: 0.5, isLock: false, time: 1791558222471 });

it("ignores unrelated fo saves and reacts to watched tokens", () => {
  const { odds, read, value } = setup();
  odds.save("OB", entry("ob-1")); odds.save("Polymarket", entry("tok-other"));
  void value.value; expect(read).toHaveBeenCalledTimes(1);
  odds.save("Polymarket", entry("tok-order"));
  void value.value; expect(read).toHaveBeenCalledTimes(2);
});
it("reacts to sport saves for watched PF tokens and to clearing", () => {
  const { sport, read, value } = setup();
  sport.save("PredictFun", "other", 1.8);
  void value.value; expect(read).toHaveBeenCalledTimes(1);
  sport.save("PredictFun", "pf-tok", 1.9);
  void value.value; expect(read).toHaveBeenCalledTimes(2);
  sport.clear();
  void value.value; expect(read).toHaveBeenCalledTimes(3);
});
it("reacts to watched lock changes and clean, and stops when the list has no watches", () => {
  const { odds, props, read, value } = setup();
  odds.updateOddsLock("Polymarket", "unrelated", true);
  void value.value; expect(read).toHaveBeenCalledTimes(1);
  odds.updateOddsLock("Polymarket", "tok-order", true);
  void value.value; expect(read).toHaveBeenCalledTimes(2);
  odds.clean("Polymarket");
  void value.value; expect(read).toHaveBeenCalledTimes(3);
  props.orderEntries = [];
  odds.clean("Polymarket");
  void value.value; expect(read).toHaveBeenCalledTimes(3);
});
