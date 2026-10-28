import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, ref, shallowRef } from "vue";
import { useArbLineOverlay, useOddsAnchorMap } from "./useArbLineOverlay";

type Host = { children: Host[]; parent: Host | null };
const node = (): Host => ({ children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: node, createText: node, createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child); },
  setText() {}, setElementText() {}, patchProp() {},
  parentNode: child => child.parent, nextSibling: () => null,
});
const frames = new Map<number, FrameRequestCallback>();
const apps: ReturnType<typeof renderer.createApp>[] = [];
let sequence = 0;
let resize: ResizeObserverCallback;
class ElementStub {
  constructor(readonly left = 0) {}
  getBoundingClientRect = vi.fn(() => ({ left: this.left, top: 0, width: 20, height: 20 } as DOMRect));
}

beforeEach(() => {
  frames.clear(); sequence = 0;
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => { frames.set(++sequence, cb); return sequence; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal("ResizeObserver", class {
    constructor(cb: ResizeObserverCallback) { resize = cb; }
    observe() {} disconnect() {}
  });
});
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); vi.unstubAllGlobals(); });
function flushFrame() {
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(cb => cb(0));
}

it("coalesces DOM measurements into a UI frame, reads latest legs and cancels disabled/unmounted work", async () => {
  const root = new ElementStub(); const home = new ElementStub(20); const away = new ElementStub(80);
  const enabled = ref(true); const revision = ref(0);
  let overlay!: ReturnType<typeof useArbLineOverlay>;
  const app = renderer.createApp({ setup() {
    overlay = useArbLineOverlay(shallowRef(root as unknown as HTMLElement), () => ({
      home: home as unknown as HTMLElement, away: away as unknown as HTMLElement,
    }), [revision, enabled], enabled);
    return () => h("div");
  } });
  apps.push(app); app.mount(node());
  revision.value++; await nextTick();
  resize([], {} as ResizeObserver);
  expect(frames.size).toBe(1);
  expect(root.getBoundingClientRect).not.toHaveBeenCalled();
  flushFrame();
  expect(overlay.line.value).toEqual({ x1: 30, y1: 10, x2: 90, y2: 10 });
  revision.value++; await nextTick();
  enabled.value = false; await nextTick();
  expect(overlay.line.value).toBeNull();
  expect(frames.size).toBe(0);
  enabled.value = true; await nextTick();
  expect(frames.size).toBe(1);
  app.unmount(); apps.pop();
  expect(frames.size).toBe(0);
});

it("keeps separate anchors for two options of the same venue and side", () => {
  const anchors = useOddsAnchorMap();
  const first = new ElementStub(); const second = new ElementStub();
  anchors.bind("PB", "Home", "first")(first);
  anchors.bind("PB", "Home", "second")(second);
  expect(anchors.get("PB", "Home", "first")).toBe(first);
  expect(anchors.get("PB", "Home", "second")).toBe(second);
  anchors.bind("PB", "Home", "first")(null);
  expect(anchors.get("PB", "Home", "first")).toBeUndefined();
  expect(anchors.get("PB", "Home", "second")).toBe(second);
});
