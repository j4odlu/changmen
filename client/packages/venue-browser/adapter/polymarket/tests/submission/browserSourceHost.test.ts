import { expect, test, vi } from "vitest";
import type { ReadonlyMarketSourcePort } from "@changmen/pm-market-data-browser";
import { createReadonlyMarketSource } from "../../../../pm-book-source";
import { pmOrderBookSource } from "@changmen/venue-browser/pm-book-source-host";
import { pmOrderBookSource as browserSource } from "@changmen/venue-browser/pm-book-source-host";
import { pmOrderBookSource as hostSource } from "@changmen/venue-browser/pm-book-source-host";
import { notePmStreamConnecting, observePmMarketStream } from "../../realtime/marketStream";

const hub = vi.hoisted(() => ({ assets: [] as string[], read: vi.fn<(consumer: string) => string[]>() }));
vi.mock("@changmen/venue-browser/polymarket/marketQuoteHub", () => ({
  getPolymarketQuoteConsumerAssetIds: hub.read.mockImplementation(() => hub.assets),
}));

test("host creates one frozen source without eager observation or asset reads; roster stays live", () => {
  expect(hub.read).not.toHaveBeenCalled();
  expect(pmOrderBookSource).toBe(browserSource);
  expect(browserSource).toBe(hostSource);
  expect(Object.isFrozen(pmOrderBookSource)).toBe(true);
  expect(Object.keys(pmOrderBookSource)).toEqual(["observe", "subscribedAssets"]);
  expect(pmOrderBookSource.observe).toBe(observePmMarketStream);
  hub.assets = ["first"];
  expect(pmOrderBookSource.subscribedAssets()).toBe(hub.assets);
  hub.assets = ["next", "last"];
  expect(browserSource.subscribedAssets()).toBe(hub.assets);
  expect(hub.read.mock.calls).toEqual([["esport"], ["esport"]]);
});

test("public source preserves immediate stream state, live notifications and disposal", () => {
  const listener = vi.fn();
  const dispose = pmOrderBookSource.observe(listener);
  try {
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].type).toBe("state");
    const epoch = notePmStreamConnecting("official");
    expect(listener).toHaveBeenLastCalledWith({ type: "state", state: { epoch, source: "official", open: false } });
    dispose();
    listener.mockClear();
    notePmStreamConnecting("official");
    expect(listener).not.toHaveBeenCalled();
  } finally { dispose(); }
});

test("callback binding is passive and preserves function identity, listener and returned disposer", () => {
  const dispose = vi.fn();
  const observe = vi.fn<ReadonlyMarketSourcePort["observe"]>(() => dispose);
  const subscribedAssets = vi.fn<ReadonlyMarketSourcePort["subscribedAssets"]>(() => ["one"]);
  const source = createReadonlyMarketSource(observe, subscribedAssets);
  expect(observe).not.toHaveBeenCalled();
  expect(subscribedAssets).not.toHaveBeenCalled();
  expect(source.observe).toBe(observe);
  expect(source.subscribedAssets).toBe(subscribedAssets);
  const listener = vi.fn();
  expect(source.observe(listener)).toBe(dispose);
  expect(observe).toHaveBeenCalledWith(listener);
  const failure = new Error("observer capacity");
  observe.mockImplementationOnce(() => { throw failure; });
  expect(() => source.observe(listener)).toThrow(failure);
  subscribedAssets.mockImplementationOnce(() => { throw failure; });
  expect(() => source.subscribedAssets()).toThrow(failure);
});
