import { afterEach, expect, it, vi } from "vitest";
import { createRenderer, h, nextTick, reactive, ssrContextKey, type Component } from "vue";
import PmFeeOdds from "./PmFeeOdds.vue";
import { loadPmDisplayFee } from "@/services/pmDisplayFees";

vi.mock("@/services/pmDisplayFees", () => ({ loadPmDisplayFee: vi.fn() }));
type Host = { text: string; children: Host[]; parent: Host | null };
const node = (text = ""): Host => ({ text, children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: () => node(), createText: node, createComment: () => node(),
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child); },
  setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; },
  patchProp() {}, parentNode: child => child.parent, nextSibling: () => null,
});
const apps: ReturnType<typeof renderer.createApp>[] = [];
function mount() {
  const props = reactive({ conditionId: "market-a", price: .5 as number | undefined });
  const root = node();
  // Vitest 编译为 SSR；宿主 renderer 读取真实 setup 的响应式文案，模板接线另由 BetRow SSR 覆盖。
  const component = { ...PmFeeOdds, render(_ctx: unknown, _cache: unknown, _props: unknown, setup: { label: string }) {
    return h("span", ` / ${setup.label}`);
  } } as Component;
  const app = renderer.createApp({ render: () => h(component, props) });
  app.provide(ssrContextKey, {});
  apps.push(app); app.mount(root);
  return { props, text: () => root.children[0]?.text };
}
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); vi.resetAllMocks(); vi.useRealTimers(); });

it("renders asynchronous fee evidence and updates prices locally without refetching", async () => {
  vi.mocked(loadPmDisplayFee).mockResolvedValue({ feeRate: .05, exponent: 1, takerOnly: true });
  const { props, text } = mount();
  expect(text()).toBe(" / —");
  await vi.waitFor(() => expect(text()).toBe(" / 1.951"));
  props.price = .2;
  await nextTick();
  expect(text()).toBe(" / 4.807");
  expect(loadPmDisplayFee).toHaveBeenCalledOnce();
  props.price = undefined;
  await nextTick();
  expect(text()).toBe(" / —");
});
it("does not apply an old market's late response to a reused odds cell", async () => {
  let completeOld!: (value: { feeRate: number; exponent: number; takerOnly: boolean }) => void;
  vi.mocked(loadPmDisplayFee).mockReturnValueOnce(new Promise(resolve => { completeOld = resolve; }))
    .mockResolvedValueOnce({ feeRate: 0, exponent: 1, takerOnly: true });
  const { props, text } = mount();
  props.conditionId = "market-b";
  await vi.waitFor(() => expect(text()).toBe(" / 2.000"));
  completeOld({ feeRate: .05, exponent: 1, takerOnly: true });
  await nextTick(); await nextTick();
  expect(text()).toBe(" / 2.000");
});
it("refreshes fee evidence and disposes its timer on unmount", async () => {
  vi.useFakeTimers();
  vi.mocked(loadPmDisplayFee).mockResolvedValue(undefined);
  const { text } = mount();
  await nextTick(); await nextTick();
  expect(text()).toBe(" / —");
  vi.mocked(loadPmDisplayFee).mockResolvedValue({ feeRate: .05, exponent: 1, takerOnly: true });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(text()).toBe(" / 1.951");
  apps.pop()!.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
