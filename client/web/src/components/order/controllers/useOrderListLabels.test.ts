import { afterEach, expect, it, vi } from "vitest";
import { computed, reactive } from "vue";
import { mountComposable } from "@/test/mountComposable";
import type { OrderRow } from "@/types/order";
import { useOrderListLabels } from "./useOrderListLabels";
const api = vi.hoisted(() => ({ ensure: vi.fn(), match: vi.fn(), bet: vi.fn(), item: vi.fn(), observe: vi.fn() }));
vi.mock("@/shared/pfOrderLabelIndex", () => ({ ensurePfOrderLabelIndex: api.ensure }));
vi.mock("@/shared/pfOrderDisplay", () => ({ pfOrderMatchText: api.match, pfOrderBetText: api.bet, pfOrderItemText: api.item }));
vi.mock("@/shared/positionEventsDisplay", () => ({ positionEventObserveTag: api.observe }));
const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); vi.resetAllMocks(); });

it("refreshes PF labels only after the existing asynchronous index loader succeeds", async () => {
  let done!: (value: boolean) => void;
  api.ensure.mockReturnValue(new Promise(resolve => { done = resolve; }));
  api.match.mockReturnValue("市场 123"); api.bet.mockReturnValue("地图2"); api.item.mockReturnValue("Team A");
  const app = mountComposable(() => useOrderListLabels({ orderEntries: [] })); mounted.push(app);
  const row: OrderRow = { Type: "PredictFun" }, label = computed(() => app.value.pfMatchText(row));
  expect(api.ensure).toHaveBeenCalledOnce(); expect(label.value).toBe("市场 123");
  api.match.mockReturnValue("Team A vs Team B");
  expect(label.value).toBe("市场 123");
  done(true); await Promise.resolve();
  expect(label.value).toBe("Team A vs Team B");
  expect(app.value.pfBetText(row)).toBe("地图2"); expect(app.value.pfItemText(row)).toBe("Team A");
});
it("observation labels receive current peers across groups without changing the rows", () => {
  api.ensure.mockResolvedValue(false);
  const first: OrderRow = { OrderID: "first" }, second: OrderRow = { OrderID: "second" };
  const props = reactive({ orderEntries: [[1, [first]], [2, [second]]] as Array<[number, OrderRow[]]> });
  const app = mountComposable(() => useOrderListLabels(props)); mounted.push(app);
  app.value.peObserveTag(first);
  expect(api.observe).toHaveBeenLastCalledWith(first, [first, second]);
  props.orderEntries = [[1, [first]]];
  app.value.peObserveTag(first);
  expect(api.observe).toHaveBeenLastCalledWith(first, [first]);
  expect(first).toEqual({ OrderID: "first" });
});
