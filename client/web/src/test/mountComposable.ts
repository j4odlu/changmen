import { createPinia, type Pinia } from "pinia";
import { createRenderer, ssrContextKey } from "vue";

type Host = { children: Host[]; parent: Host | null };
const node = (): Host => ({ children: [], parent: null });
const renderer = createRenderer<Host, Host>({
  createElement: node, createText: node, createComment: node,
  insert(child, parent) { child.parent = parent; parent.children.push(child); },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child); },
  setText() {}, setElementText() {}, patchProp() {},
  parentNode: child => child.parent, nextSibling: () => null,
});

/** Exercise real Vue mount/unmount lifetimes without a DOM or external services. */
export function mountComposable<T>(setup: () => T, pinia: Pinia = createPinia()) {
  let value!: T;
  const app = renderer.createApp({ setup() { value = setup(); return () => null; } });
  app.use(pinia);
  app.provide(ssrContextKey, {});
  app.mount(node());
  return { value, pinia, unmount: () => app.unmount() };
}
