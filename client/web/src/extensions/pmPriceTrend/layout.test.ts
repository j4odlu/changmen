import { afterEach, expect, it, vi } from "vitest";
import { observeTrendLayout } from "./layout";

afterEach(() => vi.unstubAllGlobals());

it("follows same-row and wrapped market height, rebinds replaced cards and disconnects", () => {
  let resize!: () => void;
  const observe = vi.fn(); const unobserve = vi.fn(); const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe; unobserve = unobserve; disconnect = disconnect;
  });
  let top = 10; let ownHeight = 160; let cardHeight = 160;
  const card = () => ({ classList: { contains: (name: string) => name === "bet" }, getBoundingClientRect: () => ({ top: 10, height: cardHeight }) });
  const first = card(); const group = { children: [first] as unknown[] };
  const element = { parentElement: group, getBoundingClientRect: () => ({ top, height: ownHeight }) };
  group.children.push(element);
  const update = vi.fn(); const handle = observeTrendLayout(element as unknown as HTMLElement, update);
  expect(update).toHaveBeenLastCalledWith({ height: 160, wrapped: false });
  resize(); expect(update).toHaveBeenCalledTimes(1);
  ownHeight = 36; cardHeight = 36; resize();
  expect(update).toHaveBeenLastCalledWith({ height: 36, wrapped: false });
  top = 60; ownHeight = 14; cardHeight = 80; resize();
  expect(update).toHaveBeenLastCalledWith({ height: 80, wrapped: true });
  cardHeight = 140; resize();
  expect(update).toHaveBeenLastCalledWith({ height: 140, wrapped: true });
  const next = card(); group.children = [next, element]; handle.refresh();
  expect(unobserve).toHaveBeenCalledWith(first); expect(observe).toHaveBeenCalledWith(next);
  handle.stop(); expect(disconnect).toHaveBeenCalledTimes(1);
});

it("does not allocate an observer when there is no layout parent", () => {
  const observer = vi.fn(); vi.stubGlobal("ResizeObserver", observer);
  const handle = observeTrendLayout({ parentElement: null } as HTMLElement, vi.fn());
  handle.refresh(); handle.stop(); expect(observer).not.toHaveBeenCalled();
});
