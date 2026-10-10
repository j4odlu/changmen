import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { describe, expect, it } from "vitest";
import { createRenderer, h, nextTick, ref } from "vue";
import { useExecutionTimelineScroll } from "./useExecutionTimelineScroll";

interface ViewNode {
  tag: string;
  parent: ViewNode | null;
  children: ViewNode[];
  props: Record<string, unknown>;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}
function node(tag: string): ViewNode {
  const value: ViewNode = { tag, parent: null, children: [], props: {}, scrollTop: 0, scrollHeight: 600, clientHeight: 200 };
  let position = 0;
  Object.defineProperty(value, "scrollTop", { get: () => position, set: (next: number) => { position = Math.max(0, Math.min(next, value.scrollHeight - value.clientHeight)); } });
  return value;
}
// [changmen 扩展] 用可滚动视图验证交互；无需依赖真实账号或执行下注。
const renderer = createRenderer<ViewNode, ViewNode>({
  createElement: node,
  createText: () => node("text"),
  createComment: () => node("comment"),
  setText: () => {},
  setElementText: () => {},
  patchProp: (el, key, _previous, value) => { el.props[key] = value; },
  parentNode: el => el.parent,
  nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] || null,
  insert: (el, parent, anchor) => {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
    el.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el);
  },
  remove: el => { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); },
});
function findFeed(root: ViewNode): ViewNode | undefined {
  return root.tag === "ol" ? root : root.children.map(findFeed).find(Boolean);
}
function event(sequence: number): OrderObservationEvent {
  return { version: 1, ownerUserId: "u", linkId: 1, eventId: `event-${sequence}`, attemptId: "initial",
    kind: "precheck_started", sequence, occurredAt: 1000 + sequence };
}
async function timeline(initiallyVisible: boolean) {
  const events = ref([event(1)]);
  const visible = ref(initiallyVisible);
  const app = renderer.createApp({ setup() {
    const { feedEl, onScroll } = useExecutionTimelineScroll(events, () => visible.value);
    return () => h("ol", { ref: feedEl, onScroll }, events.value.map(event => h("li", { key: event.eventId }, event.eventId)));
  } });
  const root = node("root");
  app.mount(root);
  await nextTick();
  return { app, events, visible, feed: findFeed(root)! };
}

describe("阶段时间线滚动跟随", () => {
  it("follows newly arriving records while the user is at the latest record", async () => {
    const view = await timeline(true);
    expect(view.feed.scrollTop).toBe(400);
    view.feed.scrollHeight = 900;
    view.events.value.push(event(2));
    await nextTick(); await nextTick();
    expect(view.feed.scrollTop).toBe(700);
    view.app.unmount();
  });
  it("does not pull the user away from older records when more events arrive", async () => {
    const view = await timeline(true);
    view.feed.scrollTop = 0;
    (view.feed.props.onScroll as () => void)();
    view.feed.scrollHeight = 900;
    view.events.value.push(event(2));
    await nextTick(); await nextTick();
    expect(view.feed.scrollTop).toBe(0);
    view.app.unmount();
  });
  it("follows on first expansion and preserves a manual reading position after collapse and reopen", async () => {
    const view = await timeline(false);
    expect(view.feed.scrollTop).toBe(0);
    view.visible.value = true;
    await nextTick(); await nextTick();
    expect(view.feed.scrollTop).toBe(400);
    view.feed.scrollTop = 50;
    (view.feed.props.onScroll as () => void)();
    view.visible.value = false;
    await nextTick();
    (view.feed.props.onScroll as () => void)();
    view.events.value.push(event(2));
    view.visible.value = true;
    await nextTick(); await nextTick();
    expect(view.feed.scrollTop).toBe(50);
    view.app.unmount();
  });
});
