import { renderToString } from "@vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } from "element-plus";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { NodeTypes, parse, type RootNode, type TemplateChildNode, type ElementNode } from "@vue/compiler-dom";
import { LoseOrder } from "@/models/loseOrder";
import { useActiveBetRunStore } from "@/stores/activeBetRunStore";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { resetRayMonitoring, setRayMonitoring } from "@/runtime/orderMonitoring/rayState";
import OrderView from "./OrderView.vue";
import { __testPushPolymarketMarketQuote as pushQuote, __testResetPolymarketMarketQuoteHub as resetQuotes } from "@changmen/venue-browser/polymarket";

vi.mock("element-plus/es/components/base/style/css", () => ({}));
vi.mock("element-plus/es/components/button/style/css", () => ({}));
vi.mock("element-plus/es/components/select/style/css", () => ({}));
vi.mock("element-plus/es/components/option/style/css", () => ({}));
vi.mock("@/components/order/OrderDateNav.vue", () => ({ default: { render: () => null } }));

const link = 1_791_557_222_471;

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const user = useUserStore();
  const orders = useOrderStore();
  const lose = useLoseOrderStore();
  user.config.makeUp = false;
  orders.orders.set(link, [
    { OrderID: "accepted", Link: link, Type: "OB", Match: "A vs B", Bet: "winner", Item: "Home", Status: "None", BetMoney: 100, Odds: 2 },
    { OrderID: "rejected", Link: link, Type: "RAY", Match: "A vs B", Bet: "winner", Item: "Away", Status: "Reject", BetMoney: 100, Odds: 2 },
  ]);
  const automatic = new LoseOrder({ betId: 42, linkId: link, matchId: 1, match: "A vs B",
    bet: "winner", target: "Away", betMoney: 100, betOdds: 2 });
  const manual = new LoseOrder({ betId: 43, linkId: 0, matchId: 1, match: "Manual queue",
    bet: "winner", target: "Home", betMoney: 100, betOdds: 2, isCreateOrder: true });
  const enqueue = () => {
    lose.orders.set(automatic.betId, automatic);
    lose.orders.set(manual.betId, manual);
  };
  const render = (embedded = false) => {
    const app = createSSRApp(OrderView, { embedded }).use(pinia);
    app.provide(ID_INJECTION_KEY, { prefix: 100, current: 0 });
    app.provide(ZINDEX_INJECTION_KEY, { current: 0 });
    return renderToString(app);
  };
  return { user, orders, lose, automatic, enqueue, render };
}

function expectNoMakeupExecution(html: string) {
  expect(html).not.toContain("order__makeup-close");
  expect(html).not.toContain("loseorder-container");
  expect(html).not.toContain("补单中");
  expect(html).not.toContain("补单处理中");
  expect(html).not.toContain("自动补单已关闭");
  expect(html).not.toContain("Manual queue");
}

beforeEach(() => { sessionStorage.clear(); resetRayMonitoring(); vi.restoreAllMocks(); });

it("shows cached live PM valuation on the user page but keeps admin user previews on stored order data", async () => {
  const state = setup();
  state.orders.orders.set(link, [{ OrderID: "pm", Link: link, Type: "Polymarket", PmSide: "buy", Status: "None",
    Item: "Home", BetMoney: 100, Odds: 2, PmTokenId: "preview-token", PmShares: 20, PmStakeUsdc: 10, PmFillPrice: 0.5 }]);
  pushQuote("preview-token", 0.6, 0.55);
  try {
    const userHtml = await state.render();
    expect(userHtml).toContain("浮盈"); expect(userHtml).toContain("当前可卖价");
    const adminHtml = await state.render(true);
    expect(adminHtml).toContain("买入价"); expect(adminHtml).toContain("待结算");
    expect(adminHtml).not.toMatch(/浮盈|浮亏|当前可卖价|当前赔率/);
  }
  finally { resetQuotes(); }
});

function elementsWithClass(node: RootNode | TemplateChildNode, className: string): ElementNode[] {
  const matches = node.type === NodeTypes.ELEMENT && node.props.some(prop => prop.type === NodeTypes.ATTRIBUTE
    && prop.name === "class" && prop.value?.content.split(/\s+/).includes(className)) ? [node] : [];
  const children = node.type === NodeTypes.ROOT || node.type === NodeTypes.ELEMENT ? node.children : [];
  return [...matches, ...children.flatMap(child => elementsWithClass(child, className))];
}

describe("RAY monitor placement", () => {
  it.each([false, true])("places the monitor inside the RAY order after its time, regardless of leg order (reversed=%s)", async reverse => {
    const state = setup();
    const rows = state.orders.orders.get(link)!;
    if (reverse) rows.reverse();
    const before = JSON.stringify(rows);
    const root = parse(await state.render());
    const orderNodes = elementsWithClass(root, "order");
    expect(orderNodes).toHaveLength(2);
    expect(elementsWithClass(root, "order-list__group-monitor")).toHaveLength(0);
    expect(elementsWithClass(root, "ray-link-monitor")).toHaveLength(1);
    orderNodes.forEach((order, i) => {
      const monitors = elementsWithClass(order, "ray-link-monitor");
      expect(monitors).toHaveLength(rows[i]!.Type === "RAY" ? 1 : 0);
      if (monitors.length) {
        const time = elementsWithClass(order, "time")[0]!;
        expect(order.children.indexOf(monitors[0]!)).toBeGreaterThan(order.children.indexOf(time));
        expect(elementsWithClass(monitors[0]!, "ray-link-monitor__summary")).toHaveLength(1);
        expect(elementsWithClass(monitors[0]!, "ray-link-monitor__subtitle")).toHaveLength(0);
      }
    });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("keeps the existing monitor on the original rejected RAY order when a second RAY order shares the Link", async () => {
    const state = setup();
    state.orders.orders.get(link)!.push({ OrderID: "ray-makeup", Link: link, Type: "RAY", Status: "None", CreateAt: Date.now() });
    const root = parse(await state.render()), orderNodes = elementsWithClass(root, "order");
    expect(elementsWithClass(root, "ray-link-monitor")).toHaveLength(1);
    expect(elementsWithClass(orderNodes[1]!, "ray-link-monitor")).toHaveLength(1);
    expect(elementsWithClass(orderNodes[2]!, "ray-link-monitor")).toHaveLength(0);
  });

  it("preserves the embedded workspace's hidden monitor", async () => {
    expect(elementsWithClass(parse(await setup().render(true)), "ray-link-monitor")).toHaveLength(0);
  });

  it("removes the closed monitor row from the real order view without hiding the order or consuming makeup queues", async () => {
    const state = setup();
    state.user.userId = 1;
    vi.spyOn(state.user, "isLoggedIn", "get").mockReturnValue(true);
    const row = state.orders.orders.get(link)![1]!;
    row.PlayerID = 2;
    state.enqueue();
    const before = JSON.stringify([...state.lose.orders.values()].map(order => order.toJSON()));
    expect(elementsWithClass(parse(await state.render()), "ray-link-monitor")).toHaveLength(1);
    setRayMonitoring("1", 2, "rejected", { phase: "closed", status: "reject" });
    const html = await state.render(), root = parse(html);
    expect(elementsWithClass(root, "ray-link-monitor")).toHaveLength(0);
    expect(elementsWithClass(root, "order")).toHaveLength(2);
    expect(html).toContain('class="status Reject"');
    expect(row.Status).toBe("Reject");
    expect(JSON.stringify([...state.lose.orders.values()].map(order => order.toJSON()))).toBe(before);
  });
});

describe("OrderView makeup switch visibility", () => {
  it("hides late-enqueued makeup while retaining the real accepted and rejected orders", async () => {
    const state = setup();
    const emptyHtml = await state.render();
    expectNoMakeupExecution(emptyHtml);
    expect(emptyHtml).not.toContain("order-makeup-status");
    state.enqueue();
    const html = await state.render();
    expectNoMakeupExecution(html);
    expect(html).not.toContain("order-makeup-status");
    expect(html).toContain('class="status Reject"');
    expect(html).toContain("A vs B");
    expect(state.orders.orders.get(link)?.map(row => row.OrderID)).toEqual(["accepted", "rejected"]);
    expect(state.lose.orders.size).toBe(2);
    state.lose.orders.delete(state.automatic.betId);
    expect(await state.render()).not.toContain("order-makeup-status");
  });

  it("hides and restores the existing design when the switch changes without consuming queues", async () => {
    const state = setup();
    state.enqueue();
    const before = [...state.lose.orders.values()].map(order => order.toJSON());
    for (const enabled of [true, false, true]) {
      state.user.config.makeUp = enabled;
      const html = await state.render();
      expect(html).not.toContain("套利补单中");
      if (enabled) {
        expect(html).toContain("套利补单队列 (1笔)");
        expect(html).toContain("order__makeup-close");
        expect(html).toContain("loseorder-container");
        expect(html).toContain("Manual queue");
      }
      else {
        expect(html).not.toContain("order-makeup-status");
        expectNoMakeupExecution(html);
      }
      expect([...state.lose.orders.values()].map(order => order.toJSON())).toEqual(before);
    }
  });

  it("keeps the real pending original order visible while its observation queue is hidden", async () => {
    const state = setup();
    state.enqueue();
    state.automatic.pendingVenueOrderId = "pending-original";
    state.orders.orders.set(link, [{ OrderID: "pending-original", Link: link, Type: "Polymarket",
      PmSide: "buy", Status: "Pending", Match: "Original pending match", Bet: "winner", Item: "Away",
      BetMoney: 100, Odds: 2, PmSubmittedPrice: 0.5, PmTokenId: "pending-token" }]);
    const html = await state.render();
    expectNoMakeupExecution(html);
    expect(html).not.toContain("order-makeup-status");
    expect(html).toContain("Original pending match");
    expect(html).toContain("PmPending");
    expect(html.replace(/<[^>]*>/g, "")).toContain("盈亏：待确认");
    expect(state.lose.orders.get(42)?.pendingVenueOrderId).toBe("pending-original");
  });

  it("projects waiting queues onto their own Links and removes only the consumed entry", async () => {
    const state = setup();
    state.user.config.makeUp = true;
    const otherLink = link + 1;
    state.orders.orders.set(otherLink, [
      { OrderID: "other-accepted", Link: otherLink, Type: "OB", Match: "C vs D", Item: "Away", Status: "None", BetMoney: 100, Odds: 2 },
      { OrderID: "other-rejected", Link: otherLink, Type: "RAY", Match: "C vs D", Item: "Home", Status: "Reject", BetMoney: 100, Odds: 2 },
    ]);
    const group = (html: string, linkId: number) => {
      const fieldset = html.match(new RegExp(`<fieldset[^>]*data-link-id="${linkId}"[^>]*>[\\s\\S]*?</fieldset>`));
      expect(fieldset).not.toBeNull();
      return fieldset![0];
    };
    expect(await state.render()).not.toContain("补单中");

    // No runtime phase or account yet: waiting conditions still belong to the queue.
    state.lose.orders.set(42, state.automatic);
    let html = await state.render();
    expect(group(html, link)).toContain("补单中");
    expect(group(html, otherLink)).not.toContain("补单中");

    state.lose.orders.set(44, new LoseOrder({ betId: 44, linkId: otherLink, matchId: 2,
      match: "C vs D", bet: "winner", target: "Home", betMoney: 100, betOdds: 2 }));
    html = await state.render();
    expect(group(html, link)).toContain("补单中");
    expect(group(html, otherLink)).toContain("补单中");
    expect(html).toContain("套利补单队列 (2笔)");

    state.lose.orders.delete(42);
    html = await state.render();
    expect(group(html, link)).not.toContain("补单中");
    expect(group(html, link)).toContain('class="status Reject"');
    expect(group(html, otherLink)).toContain("补单中");
    expect(html).toContain("套利补单队列 (1笔)");
  });

  it("does not let stale realtime makeup override the current queue or switch", async () => {
    const state = setup();
    state.user.config.makeUp = true;
    state.lose.orders.set(42, state.automatic);
    const active = useActiveBetRunStore();
    active.upsertRun(42, {
      matchId: 1, matchTitle: "A vs B", betName: "winner", linkId: link,
      phase: "makeup", overallLabel: "补单中",
      legs: [{ side: "B", platform: "RAY", target: "Away", status: "makeup", events: [] }],
    });
    let html = await state.render();
    expect(html).toContain("补单中");
    expect(html).toContain("补单处理中");

    state.user.config.makeUp = false;
    html = await state.render();
    expectNoMakeupExecution(html);
    expect(html).not.toContain("order-makeup-status");

    active.setPhase(42, "syncing", "自动补单已关闭");
    active.patchLeg(42, "B", { status: "rejected", detail: "自动补单已关闭，未执行补单" });
    expectNoMakeupExecution(await state.render());

    state.user.config.makeUp = true;
    html = await state.render();
    expect(html).toContain("补单中");
    expect(html).toContain("套利补单队列 (1笔)");
    expect(html).not.toContain("自动补单已关闭");
    state.lose.orders.delete(42);
    html = await state.render();
    expectNoMakeupExecution(html);
    expect(html).toContain('class="status Reject"');
    expect(html).not.toContain("order-makeup-status");
  });

  it("does not count or display observation-only entries even when makeup is enabled", async () => {
    const state = setup();
    state.user.config.makeUp = true;
    state.automatic.pendingVenueOrderId = "original";
    state.automatic.pendingVenueMakeUpEligible = false;
    state.enqueue();
    state.lose.orders.delete(43);
    state.orders.orders.set(link, [{ OrderID: "original", Link: link, Type: "Polymarket",
      PmSide: "buy", Status: "Pending", Item: "Away", BetMoney: 100, Odds: 2,
      PmSubmittedPrice: 0.5, PmTokenId: "original-token" }]);
    const html = await state.render();
    expectNoMakeupExecution(html);
    expect(html).not.toContain("order-makeup-status");
    expect(html).toContain("PmPending");
    expect(state.lose.orders.get(42)?.pendingVenueOrderId).toBe("original");
    state.automatic.pendingVenueMakeUpEligible = true;
    expect(await state.render()).toContain("套利补单队列 (1笔)");
  });

  it("retains a successful RAY leg's confirmation after the other makeup leg leaves the queue", async () => {
    const state = setup();
    state.user.config.makeUp = true;
    state.orders.orders.set(link, [
      { OrderID: "ray-accepted", Link: link, Type: "RAY", Item: "Home", Status: "None", BetMoney: 100, Odds: 2 },
      { OrderID: "pm-rejected", Link: link, Type: "Polymarket", Item: "Away", Status: "Reject", BetMoney: 100, Odds: 2 },
    ]);
    useActiveBetRunStore().upsertRun(42, {
      matchId: 1, matchTitle: "A vs B", betName: "winner", linkId: link,
      phase: "syncing", overallLabel: "双腿已成交", terminalAt: Date.now(),
      legs: [
        { side: "A", platform: "RAY", target: "Home", status: "confirmed", events: [] },
        { side: "B", platform: "Polymarket", target: "Away", status: "makeup", events: [] },
      ],
    });
    const html = await state.render();
    expect(html).toContain("首次确认通过");
    expect(html).not.toContain("等待恢复监控");
    expect(html).not.toContain("补单中");
    expect(html).not.toContain("order-makeup-status");
  });
});
