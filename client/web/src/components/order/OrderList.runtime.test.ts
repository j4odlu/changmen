import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import { createRenderer, h, nextTick, reactive, ssrContextKey } from "vue";
import { useOddsStore } from "@/stores/oddsStore";
import type { OrderRow } from "@/types/order";
import OrderList from "./OrderList.vue";
import orderSource from "./OrderList.vue?raw";
import { installClientRender } from "@/test/installClientRender";
import OrderProfitLine from "./presentation/OrderProfitLine.vue";
import profitSource from "./presentation/OrderProfitLine.vue?raw";
import OrderQuoteLine from "./presentation/OrderQuoteLine.vue";
import quoteSource from "./presentation/OrderQuoteLine.vue?raw";
import OrderMarketDetails from "./presentation/OrderMarketDetails.vue";
import marketSource from "./presentation/OrderMarketDetails.vue?raw";
import OrderStatusBadge from "./presentation/OrderStatusBadge.vue";
import statusSource from "./presentation/OrderStatusBadge.vue?raw";
import OrderTag from "./presentation/OrderTag.vue";
import tagSource from "./presentation/OrderTag.vue?raw";
import OrderLiveQuoteLine from "./presentation/OrderLiveQuoteLine.vue";
import liveSource from "./presentation/OrderLiveQuoteLine.vue?raw";

const api = vi.hoisted(() => ({ pmSell: vi.fn(), pfSell: vi.fn(), confirm: vi.fn() }));
const flags = reactive({ pmBusy: false, pfBusy: false, pmClosing: false });
vi.mock("@/stores/account/pmManualSell", () => ({ canManualSellPmBuy: () => true, confirmAndSellPmBuyOrder: api.pmSell,
  isPmManualSellClosing: () => flags.pmClosing, isPmManualSellInFlight: () => flags.pmBusy }));
vi.mock("@/stores/account/pfManualSell", () => ({ canManualSellPfBuy: () => true, confirmAndSellPfBuyOrder: api.pfSell,
  isPfManualSellInFlight: () => flags.pfBusy }));
vi.mock("element-plus", () => ({ ElMessageBox: { confirm: api.confirm }, ElMessage: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/shared/pfOrderLabelIndex", () => ({ ensurePfOrderLabelIndex: async () => false }));
vi.mock("@/orderModes/OrderDetails.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/platform/PlatformIcon.vue", () => ({ default: { render: () => null } }));

for (const [component, source, filename] of [
  [OrderList, orderSource, "OrderList.vue"], [OrderProfitLine, profitSource, "OrderProfitLine.vue"],
  [OrderQuoteLine, quoteSource, "OrderQuoteLine.vue"], [OrderMarketDetails, marketSource, "OrderMarketDetails.vue"],
  [OrderStatusBadge, statusSource, "OrderStatusBadge.vue"], [OrderTag, tagSource, "OrderTag.vue"],
  [OrderLiveQuoteLine, liveSource, "OrderLiveQuoteLine.vue"],
] as const) installClientRender(component, source, filename);

type Host = { tag: string; text: string; props: Record<string, unknown>; parent: Host | null; children: Host[] };
const node = (tag: string, text = ""): Host => ({ tag, text, props: {}, parent: null, children: [] });
const renderer = createRenderer<Host, Host>({
  createElement: tag => node(tag), createText: text => node("#text", text), createComment: () => node("#comment"),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child);
  },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); child.parent = null; },
  setText(child, text) { child.text = text; },
  setElementText(child, text) { child.text = text; child.children = []; },
  patchProp(child, key, _previous, value) { child.props[key] = value; },
  parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
});
const apps: Array<{ unmount: () => void }> = [];
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(flags, { pmBusy: false, pfBusy: false, pmClosing: false });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { body: { classList: { remove: vi.fn() } } });
  api.confirm.mockResolvedValue("confirm");
});
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); vi.unstubAllGlobals(); });
function mount(row: OrderRow) {
  const cancelled = vi.fn();
  const props = reactive({ orderEntries: [[1791558222471, [row]]] as Array<[number, OrderRow[]]>, allowPmSell: false, allowPfSell: false });
  const pinia = createPinia(), root = node("root");
  const app = renderer.createApp({ render: () => h(OrderList, { ...props, onCancelMakeup: cancelled }) });
  app.use(pinia); app.provide(ssrContextKey, {}); app.mount(root); apps.push(app);
  return { props, root, cancelled, odds: useOddsStore(pinia), row: props.orderEntries[0]![1][0]! };
}
function text(host: Host): string { return (host.text + host.children.map(text).join("")).replace(/\s+/g, " "); }
function find(host: Host, className: string): Host | undefined {
  if (String(host.props.class ?? "").split(/\s+/).includes(className)) return host;
  for (const child of host.children) { const result = find(child, className); if (result) return result; }
  return undefined;
}
const pm: OrderRow = { OrderID: "pm", Type: "Polymarket", PmSide: "buy", Status: "Pending", BetMoney: 72,
  Match: "A vs B", Bet: "地图2", Item: "A", PmTokenId: "token", PmSubmittedPrice: 0.5 };

it("updates mounted Pending, fills, live prices and 50/50 financial status without remounting", async () => {
  const { root, row, odds } = mount({ ...pm, Money: 999 });
  expect(text(root)).toContain("申请金额：72 盈亏：待确认");
  Object.assign(row, { Status: "None", PmShares: 20, PmStakeUsdc: 10, PmFillPrice: 0.5 });
  odds.save("Polymarket", { id: "token", odds: 1 / 0.6, clobPrice: 0.6, isLock: false, time: 1791558222471 });
  await nextTick();
  expect(text(root)).toContain("买入金额：72 盈亏：待结算");
  expect(text(root)).toContain("当前价：0.6"); expect(text(root)).toContain("浮盈：+");
  Object.assign(row, { Status: "Lose", Money: -5, PmMatchResult: "EqualSplit", PmSellState: "settled" });
  await nextTick();
  expect(text(root)).toContain("50/50 已结算"); expect(text(root)).toContain("盈亏：-5");
  expect(find(root, "Lose")).toBeDefined(); expect(text(root)).not.toContain("当前价：");
  expect(api.pmSell).not.toHaveBeenCalled(); expect(api.pfSell).not.toHaveBeenCalled();
  expect(row.Money).toBe(-5); expect(row.PmStakeUsdc).toBe(10);
});
it("preserves permission changes, in-flight state and PM sell delegation in the actual parent", async () => {
  const { root, props, row } = mount({ ...pm, Status: "None" });
  expect(find(root, "order__sell-btn")).toBeUndefined();
  props.allowPmSell = true; await nextTick();
  const button = find(root, "order__sell-btn")!;
  (button.props.onClick as () => void)();
  expect(api.pmSell).toHaveBeenCalledExactlyOnceWith(row);
  flags.pmBusy = true; flags.pmClosing = true; await nextTick();
  expect(text(find(root, "order__sell-btn")!)).toBe("卖出中…");
  expect(find(root, "order__sell-btn")!.props.disabled).toBe(true); expect(find(root, "PmClosing")).toBeDefined();
  row.DisplayOnly = true; await nextTick();
  expect(find(root, "order__sell-btn")).toBeUndefined();
});
it("preserves PF permission/busy state and delegates to its own sell service", async () => {
  const { root, props, row } = mount({ OrderID: "pf", Type: "PredictFun", Status: "None", Match: "A vs B", Bet: "地图2", Item: "A" });
  props.allowPfSell = true; await nextTick();
  (find(root, "order__sell-btn")!.props.onClick as () => void)();
  expect(api.pfSell).toHaveBeenCalledExactlyOnceWith(row); expect(api.pmSell).not.toHaveBeenCalled();
  flags.pfBusy = true; await nextTick();
  expect(find(root, "order__sell-btn")!.props.disabled).toBe(true);
  expect(text(find(root, "order__sell-btn")!)).toBe("卖出中…");
});
it("emits the existing makeup cancellation event only after confirmation", async () => {
  const { root, cancelled } = mount({ OrderID: "makeup-123", Type: "OB", Status: "MakeupPending" });
  let confirmed!: (value: string) => void;
  api.confirm.mockReturnValue(new Promise(resolve => { confirmed = resolve; }));
  (find(root, "order__makeup-close")!.props.onClick as () => void)();
  expect(cancelled).not.toHaveBeenCalled();
  confirmed("confirm"); await Promise.resolve();
  expect(cancelled).toHaveBeenCalledExactlyOnceWith(123);
});
