import { afterEach, expect, test, vi } from "vitest";
import * as stream from "@changmen/venue-browser/polymarket/marketStream";
import type { MarketStreamEvent } from "@changmen/pm-market-data-browser/marketStreamProtocol";
const disposers: Array<() => void> = [];
afterEach(() => { for (const off of disposers.splice(0)) off(); vi.restoreAllMocks(); });

test("observers receive the current connection state and frozen updates", () => {
  const epoch = stream.notePmStreamConnecting("official"), events: MarketStreamEvent[] = [];
  disposers.push(stream.observePmMarketStream(event => events.push(event)));
  expect(events).toEqual([{ type: "state", state: { epoch, source: "official", open: false } }]);
  stream.notePmStreamOpen(epoch, true);
  expect(events.at(-1)).toEqual({ type: "state", state: { epoch, source: "official", open: true } });
  expect(Object.isFrozen(events.at(-1))).toBe(true);
});

test("admission, initial delivery failures and listener removal retain the four-observer limit", () => {
  disposers.push(stream.observePmMarketStream(() => { throw Error("initial failure"); }));
  for (let i = 0; i < 4; i++) disposers.push(stream.observePmMarketStream(() => {}));
  expect(() => stream.observePmMarketStream(() => {})).toThrow("market observer capacity");
  disposers.pop()!();
  expect(() => disposers.push(stream.observePmMarketStream(() => {}))).not.toThrow();
});

test("frames preserve shared sequence, epoch filtering, PONG filtering and reconnect reset", () => {
  const events: MarketStreamEvent[] = [];
  disposers.push(stream.observePmMarketStream(event => events.push(event)));
  const first = stream.notePmStreamConnecting("official");
  stream.notePmStreamFrame(first, "closed", 10, 11);
  stream.notePmStreamOpen(first, true);
  stream.notePmStreamFrame(first, "PONG", 10, 11);
  stream.notePmStreamFrame(first, "one", 12, 13);
  stream.notePmStreamFrame(first, "two", 14, 15);
  const second = stream.notePmStreamConnecting("changmen");
  stream.notePmStreamOpen(first, true);
  stream.notePmStreamFrame(first, "stale", 16, 17);
  stream.notePmStreamOpen(second, true);
  stream.notePmStreamFrame(second, "three", 18, 19);
  expect(events.filter(event => event.type === "frame")).toEqual([
    { type: "frame", epoch: first, sequence: 1, raw: "one", wallAt: 12, receivedAt: 13 },
    { type: "frame", epoch: first, sequence: 2, raw: "two", wallAt: 14, receivedAt: 15 },
    { type: "frame", epoch: second, sequence: 1, raw: "three", wallAt: 18, receivedAt: 19 },
  ]);
});

test("failing observers are removed without disrupting peers, and disposal stops clock reads", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(123);
  expect(stream.capturePmStreamTime()).toBe(0);
  expect(clock).not.toHaveBeenCalled();
  const failed = vi.fn((event: MarketStreamEvent) => { if (event.type === "frame") throw Error("frame failure"); });
  const peer = vi.fn();
  disposers.push(stream.observePmMarketStream(failed), stream.observePmMarketStream(peer));
  const epoch = stream.notePmStreamConnecting("official");
  stream.notePmStreamOpen(epoch, true);
  expect(stream.capturePmStreamTime()).toBe(performance.timeOrigin + 123);
  failed.mockClear(); peer.mockClear();
  stream.notePmStreamFrame(epoch, "first", 1, 2);
  stream.notePmStreamFrame(epoch, "second", 3, 4);
  expect(failed).toHaveBeenCalledTimes(1); expect(peer).toHaveBeenCalledTimes(2);
  for (const off of disposers.splice(0)) off();
  peer.mockClear(); clock.mockClear();
  stream.notePmStreamFrame(epoch, "disposed", 5, 6);
  expect(peer).not.toHaveBeenCalled(); expect(stream.capturePmStreamTime()).toBe(0);
  expect(clock).not.toHaveBeenCalled();
});
