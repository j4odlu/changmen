import { afterEach, expect, test, vi } from "vitest";
import * as canonical from "@changmen/venue-browser/polymarket/marketStream";
import * as legacy from "../../realtime/marketStream";
import type { MarketStreamEvent } from "@changmen/pm-market-data-browser/marketStreamProtocol";
const disposers: Array<() => void> = [];
afterEach(() => { for (const off of disposers.splice(0)) off(); vi.restoreAllMocks(); });

test("old and public entries expose the same functions and share connection state", () => {
  expect(Object.keys(legacy).sort()).toEqual(Object.keys(canonical).sort());
  for (const key of Object.keys(canonical) as Array<keyof typeof canonical>) expect(legacy[key]).toBe(canonical[key]);
  const epoch = legacy.notePmStreamConnecting("official"), events: MarketStreamEvent[] = [];
  disposers.push(canonical.observePmMarketStream(event => events.push(event)));
  expect(events).toEqual([{ type: "state", state: { epoch, source: "official", open: false } }]);
  legacy.notePmStreamOpen(epoch, true);
  expect(events.at(-1)).toEqual({ type: "state", state: { epoch, source: "official", open: true } });
  expect(Object.isFrozen(events.at(-1))).toBe(true);
});

test("admission, initial delivery failures and listener removal retain the four-observer limit", () => {
  disposers.push(legacy.observePmMarketStream(() => { throw Error("initial failure"); }));
  for (let i = 0; i < 4; i++) disposers.push((i % 2 ? legacy : canonical).observePmMarketStream(() => {}));
  expect(() => canonical.observePmMarketStream(() => {})).toThrow("market observer capacity");
  disposers.pop()!();
  expect(() => disposers.push(legacy.observePmMarketStream(() => {}))).not.toThrow();
});

test("frames preserve shared sequence, epoch filtering, PONG filtering and reconnect reset", () => {
  const events: MarketStreamEvent[] = [];
  disposers.push(legacy.observePmMarketStream(event => events.push(event)));
  const first = canonical.notePmStreamConnecting("official");
  legacy.notePmStreamFrame(first, "closed", 10, 11);
  canonical.notePmStreamOpen(first, true);
  legacy.notePmStreamFrame(first, "PONG", 10, 11);
  legacy.notePmStreamFrame(first, "one", 12, 13);
  canonical.notePmStreamFrame(first, "two", 14, 15);
  const second = legacy.notePmStreamConnecting("changmen");
  canonical.notePmStreamOpen(first, true);
  legacy.notePmStreamFrame(first, "stale", 16, 17);
  canonical.notePmStreamOpen(second, true);
  legacy.notePmStreamFrame(second, "three", 18, 19);
  expect(events.filter(event => event.type === "frame")).toEqual([
    { type: "frame", epoch: first, sequence: 1, raw: "one", wallAt: 12, receivedAt: 13 },
    { type: "frame", epoch: first, sequence: 2, raw: "two", wallAt: 14, receivedAt: 15 },
    { type: "frame", epoch: second, sequence: 1, raw: "three", wallAt: 18, receivedAt: 19 },
  ]);
});

test("failing observers are removed without disrupting peers, and disposal stops clock reads", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(123);
  expect(canonical.capturePmStreamTime()).toBe(0);
  expect(clock).not.toHaveBeenCalled();
  const failed = vi.fn((event: MarketStreamEvent) => { if (event.type === "frame") throw Error("frame failure"); });
  const peer = vi.fn();
  disposers.push(canonical.observePmMarketStream(failed), legacy.observePmMarketStream(peer));
  const epoch = canonical.notePmStreamConnecting("official");
  legacy.notePmStreamOpen(epoch, true);
  expect(legacy.capturePmStreamTime()).toBe(performance.timeOrigin + 123);
  failed.mockClear(); peer.mockClear();
  canonical.notePmStreamFrame(epoch, "first", 1, 2);
  legacy.notePmStreamFrame(epoch, "second", 3, 4);
  expect(failed).toHaveBeenCalledTimes(1); expect(peer).toHaveBeenCalledTimes(2);
  for (const off of disposers.splice(0)) off();
  peer.mockClear(); clock.mockClear();
  canonical.notePmStreamFrame(epoch, "disposed", 5, 6);
  expect(peer).not.toHaveBeenCalled(); expect(legacy.capturePmStreamTime()).toBe(0);
  expect(clock).not.toHaveBeenCalled();
});
