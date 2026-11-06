import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { mountComposable } from "@/test/mountComposable";
import type { OrderRow } from "@/types/order";
import { useOrderLinkRebind } from "./useOrderLinkRebind";

const api = vi.hoisted(() => ({ confirm: vi.fn(), rebind: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("element-plus", () => ({ ElMessageBox: { confirm: api.confirm }, ElMessage: { success: api.success, error: api.error } }));
vi.mock("@/api/order", () => ({ rebindOrderLink: api.rebind }));

class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  dataset: Record<string, string> = {};
  style = {};
  attributes = new Map<string, string>();
  classes = new Set<string>();
  classList = { add: (value: string) => this.classes.add(value), remove: (value: string) => this.classes.delete(value) };
  setPointerCapture = vi.fn();
  constructor(public tag = "span") {}
  appendChild(child: FakeElement) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  querySelector(tag: string) { return this.children.find(child => child.tag === tag) ?? null; }
  closest() { return this.dataset.rebindOrderId ? this : null; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 30, height: 40 }; }
}
const source: OrderRow = { OrderID: "new-order-1234567890", Link: 1791558222471, Type: "Polymarket", Match: "<b>A vs B</b>", Bet: "地图2", Item: "A" };
const target: OrderRow = { OrderID: "old-order", Link: 1791558221471, Type: "OB", Match: "A vs B", Bet: "地图2", Item: "B" };
let body: FakeElement, hit: ReturnType<typeof vi.fn>, win: EventTarget;
const mounted: Array<{ unmount: () => void }> = [];
beforeEach(() => {
  vi.resetAllMocks(); api.confirm.mockResolvedValue("confirm"); api.rebind.mockResolvedValue(true);
  body = new FakeElement("body"); hit = vi.fn(); win = new EventTarget();
  vi.stubGlobal("Element", FakeElement); vi.stubGlobal("window", win);
  vi.stubGlobal("document", { body, elementFromPoint: hit, createElementNS: (_ns: string, tag: string) => new FakeElement(tag) });
});
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(allowLinkRebind = true) {
  const props = reactive({ allowLinkRebind, playerLabel: () => "test-player", orderEntries: [[source.Link!, [source]], [target.Link!, [target]]] as Array<[number, OrderRow[]]> });
  const done = vi.fn(), app = mountComposable(() => useOrderLinkRebind(props, done)); mounted.push(app);
  const sourceBadge = new FakeElement(); sourceBadge.dataset.rebindOrderId = String(source.OrderID);
  const targetBadge = new FakeElement(); targetBadge.dataset.rebindOrderId = String(target.OrderID); hit.mockReturnValue(targetBadge);
  return { ...app, c: app.value, props, done, sourceBadge, targetBadge };
}
function pointer(currentTarget: FakeElement, fields: Partial<PointerEvent> = {}) {
  return { pointerId: 1, button: 0, clientX: 50, clientY: 60, currentTarget,
    preventDefault: vi.fn(), stopPropagation: vi.fn(), ...fields } as unknown as PointerEvent;
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

it("requires confirmation for new-to-old rebinding and preserves exact API/event sequencing", async () => {
  const { c, done, sourceBadge } = setup();
  let confirm!: (value: string) => void;
  api.confirm.mockReturnValue(new Promise(resolve => { confirm = resolve; }));
  c.onBadgePointerDown(pointer(sourceBadge), source);
  expect(c.drag.value?.orderId).toBe(source.OrderID);
  expect(sourceBadge.setPointerCapture).toHaveBeenCalledWith(1);
  expect(body.children).toHaveLength(1);
  c.onBadgePointerMove(pointer(sourceBadge));
  expect(c.badgeClass(target)["order__platform-badge--drop-ok"]).toBe(true);
  c.onBadgePointerUp(pointer(sourceBadge));
  expect(c.drag.value).toBeNull(); expect(body.children).toHaveLength(0);
  expect(api.confirm.mock.calls[0]![0]).toContain("A vs B");
  expect(api.confirm.mock.calls[0]![0]).not.toContain("<b>");
  expect(api.rebind).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
  confirm("confirm"); await flush();
  expect(api.rebind).toHaveBeenCalledExactlyOnceWith({ orderId: source.OrderID, toLinkId: target.Link });
  expect(api.success).toHaveBeenCalledWith("Link 已改绑"); expect(done).toHaveBeenCalledOnce();
});
it("preserves permission, primary pointer, display-only and newer-target restrictions", async () => {
  const { c, props, sourceBadge } = setup(false);
  c.onBadgePointerDown(pointer(sourceBadge), source); expect(c.drag.value).toBeNull();
  props.allowLinkRebind = true;
  c.onBadgePointerDown(pointer(sourceBadge, { button: 1 }), source); expect(c.drag.value).toBeNull();
  c.onBadgePointerDown(pointer(sourceBadge), { ...source, DisplayOnly: true }); expect(c.drag.value).toBeNull();
  c.onBadgePointerDown(pointer(sourceBadge), target);
  hit.mockReturnValue(sourceBadge);
  expect(c.badgeClass(source)["order__platform-badge--drop-blocked"]).toBe(true);
  c.onBadgePointerUp(pointer(sourceBadge)); await flush();
  expect(api.confirm).not.toHaveBeenCalled(); expect(api.rebind).not.toHaveBeenCalled();
});
it("cancelled confirmation and failed API calls never emit completion", async () => {
  const { c, done, sourceBadge } = setup();
  api.confirm.mockRejectedValue("cancel");
  c.onBadgePointerDown(pointer(sourceBadge), source); c.onBadgePointerUp(pointer(sourceBadge)); await flush();
  expect(api.rebind).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
  api.confirm.mockResolvedValue("confirm"); api.rebind.mockRejectedValue(Error("server rejected"));
  c.onBadgePointerDown(pointer(sourceBadge), source); c.onBadgePointerUp(pointer(sourceBadge)); await flush();
  expect(api.error).toHaveBeenCalledWith("server rejected"); expect(done).not.toHaveBeenCalled();
});
it("ignores other pointers and clears drag resources on Escape, cancellation and unmount", () => {
  const remove = vi.spyOn(win, "removeEventListener");
  const { c, sourceBadge, unmount } = setup();
  c.onBadgePointerDown(pointer(sourceBadge), source);
  c.onBadgePointerUp(pointer(sourceBadge, { pointerId: 2 }));
  expect(c.drag.value).not.toBeNull();
  const escape = new Event("keydown"); Object.assign(escape, { key: "Escape" }); win.dispatchEvent(escape);
  expect(c.drag.value).toBeNull(); expect(body.classes.has("order-link-rebind-dragging")).toBe(false);
  c.onBadgePointerDown(pointer(sourceBadge), source); c.onBadgePointerCancel(pointer(sourceBadge));
  expect(c.drag.value).toBeNull();
  c.onBadgePointerDown(pointer(sourceBadge), source); unmount(); mounted.pop();
  expect(body.children).toHaveLength(0); expect(c.drag.value).toBeNull();
  expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
  expect(api.rebind).not.toHaveBeenCalled();
});
