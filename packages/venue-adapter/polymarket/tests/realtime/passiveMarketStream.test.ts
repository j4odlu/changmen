import { useFakeMailboxTasks } from '../helpers/mailboxTasks';
useFakeMailboxTasks();
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { observePmMarketStream } from "../../realtime/marketStream";
import type { MarketStreamEvent } from "../../realtime/marketStreamProtocol";
import { registerPolymarketQuoteAssets, onPolymarketMarketQuote, __testResetPolymarketMarketQuoteHub } from "../../quotes/marketQuoteHub";
import { resetPmMarketWsSourceModeForTests } from "../../pmMarketWsMode";
import { resetPmRoutingPreferenceForTests, setPmRoutingPreference } from "../../pmRoutingPreference";
import { resetOfficialFailStreakForTests } from "../../ws";
import { resetPolymarketLiveQuoteTsForTests } from "../../pmTokenQuote";
import { OwnedWorkerFixture as WsBookShadowWorkerClient } from "../helpers/ownedBookFixtures";
import type { ServiceMessage } from "../../realtime/orderBook/serviceProtocol";
import { beginWsBookShadow } from "../../submission/preflight/optimized/wsBook/shadowObserver";
import type { ShadowWorkerRequest, ShadowWorkerResponse } from "../../submission/preflight/optimized/wsBook/shadowWorkerProtocol";

class Socket {
  static instances: Socket[] = []; static OPEN = 1;
  readyState = 0; onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  sent: string[] = []; closed = 0;
  constructor(readonly url: string) { Socket.instances.push(this); }
  send(s: string) { this.sent.push(s); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { ++this.closed; this.readyState = 3; this.onclose?.(); }
  frame(data: string) { this.onmessage?.({ data }); }
}
class Port {
  onmessage: Worker["onmessage"] = null; onerror: Worker["onerror"] = null; onmessageerror: Worker["onmessageerror"] = null;
  scope = 0;
  messages: ShadowWorkerRequest[] = []; autoAck = true; terminate = vi.fn();
  receive(message: ShadowWorkerResponse) { const data = message.type === "sample" || message.type === "report" ? { type: "consumer", scope: this.scope, payload: message } : message; this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent); }
  postMessage(data: ServiceMessage) {
    if (data.type === 'batch') { for (const m of data.requests) {
      if (m.type === "attach") this.scope = m.scope;
      if (m.type === "consumer") this.messages.push(m.payload as ShadowWorkerRequest);
      if (m.type === "stream" || m.type === "assets") this.messages.push(m as ShadowWorkerRequest);
    } if (this.autoAck) this.receive({ type: 'batch_ack', id: data.id }); }

  }
}
const raw = () => JSON.stringify({ event_type: "book", asset_id: "1", market: "m", timestamp: String(Date.now()), hash: "h", bids: [], asks: [{ price: "0.5", size: "2" }] });
let releases: Array<() => void>;
beforeEach(() => {
  vi.useFakeTimers(); Socket.instances = []; releases = [];
  vi.stubGlobal("WebSocket", Socket); resetPmMarketWsSourceModeForTests("official"); resetPmRoutingPreferenceForTests();
  setPmRoutingPreference("official"); resetOfficialFailStreakForTests(); resetPolymarketLiveQuoteTsForTests();
});
afterEach(() => { releases.forEach(fn => fn()); __testResetPolymarketMarketQuoteHub(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function start() { registerPolymarketQuoteAssets("esport", ["1", "2"]); Socket.instances.at(-1)!.open(); return Socket.instances.at(-1)!; }

test("with and without passive observation, original subscriptions, quotes, PING and reconnect traces match", () => {
  const replay = (observe: boolean) => {
    resetPolymarketLiveQuoteTsForTests();
    const quotes: unknown[] = []; const offQuote = onPolymarketMarketQuote(q => quotes.push(q));
    const off = observe ? observePmMarketStream(event => { if (event.type === "frame") throw Error("observer failure"); }) : () => {};
    const begin = Socket.instances.length, first = start(); first.frame(raw());
    registerPolymarketQuoteAssets("esport", ["1", "2"]);
    vi.advanceTimersByTime(10_000); first.frame("PONG"); first.close();
    vi.advanceTimersByTime(4999); expect(Socket.instances.length).toBe(begin + 1);
    vi.advanceTimersByTime(1); const second = Socket.instances.at(-1)!; second.open(); second.frame(raw());
    const trace = { connections: Socket.instances.length - begin, first: [...first.sent], second: [...second.sent], quotes };
    off(); offQuote(); __testResetPolymarketMarketQuoteHub(); return trace;
  };
  expect(replay(true)).toEqual(replay(false));
});
test("raw listener runs after legacy quote handling; lifecycle has actual source identity and ignores old sockets", () => {
  const first = start(), events: MarketStreamEvent[] = [], order: string[] = [];
  releases.push(onPolymarketMarketQuote(() => order.push("quote")), observePmMarketStream(event => { events.push(event); if (event.type === "frame") order.push("raw"); }));
  first.frame(raw()); expect(order).toEqual(["quote", "raw"]);
  const old = first.onmessage!; first.close(); const count = events.length; old({ data: raw() }); expect(events).toHaveLength(count);
  resetPmMarketWsSourceModeForTests("changmen"); vi.advanceTimersByTime(5000); Socket.instances.at(-1)!.open();
  expect(events.at(-1)).toMatchObject({ type: "state", state: { open: true, source: "changmen" } });
});
test("passive client shares exactly one PM-M; coverage uses existing subscriptions without sending or changing ownership", () => {
  const first = start(), before = [...first.sent], worker = new Port();
  const allowed = vi.fn(() => true);
  const client = new WsBookShadowWorkerClient(allowed, () => worker); releases.push(() => client.stop());
  client.setAssets(["1", "999"]); allowed.mockClear(); first.frame(raw());
  expect(allowed).not.toHaveBeenCalled(); // Hot frames/ACKs do not rescan account/localStorage routes.
  vi.advanceTimersByTime(16);
  expect(client.report()).toMatchObject({ feed: "passive-pm-m", requestedAssets: 2, assets: 1, uncoveredAssets: 1, pendingStream: 0 });
  expect(worker.messages.some(m => m.type === "stream" && m.event.type === "frame")).toBe(true);
  expect(Socket.instances).toHaveLength(1); expect(first.sent).toEqual(before);
  for (let i = 0; i < 7; i++) { vi.advanceTimersByTime(10_000); first.frame("PONG"); }
  expect(Socket.instances).toHaveLength(1);
  expect(first.sent.filter(message => message !== "PING")).toEqual(before);
  client.stop(); expect(first.closed).toBe(0); first.frame(raw()); expect(first.sent.filter(message => message !== "PING")).toEqual(before);
});
test.each(["entries", "bytes", "single_frame", "timeout"])("bounded %s overflow disables only observer and never creates a replacement connection", kind => {
  const first = start(), worker = new Port(), client = new WsBookShadowWorkerClient(() => true, () => worker);
  releases.push(() => client.stop()); client.setAssets(["1"]); worker.autoAck = false;
  const queuedCallback = worker.onmessage;
  if (kind === "entries") for (let i = 0; i < 2049; i++) first.frame(raw());
  if (kind === "bytes") for (let i = 0; i < 3; i++) first.frame("x".repeat(800_000));
  if (kind === "single_frame") first.frame("x".repeat(1_000_001));
  if (kind === "timeout") { first.frame(raw()); vi.advanceTimersByTime(2000); }
  expect(worker.terminate).toHaveBeenCalledOnce(); expect(client.report().worker).toBe(false);
  expect(client.report().pendingStreamChars).toBe(0); expect(Socket.instances).toHaveLength(1); expect(first.closed).toBe(0);
  const last = worker.messages.findLast(message => message.type === "stream");
  queuedCallback?.call(worker as unknown as Worker, { data: { type: "report", generation: last?.generation,
    report: { snapshotsInMemory: 99 } } } as MessageEvent);
  expect(client.report().snapshotsInMemory).toBe(0);
  first.frame(raw()); client.stop(); expect(first.closed).toBe(0);
});
test("a relay connection cannot be relabelled official by changing the preference alone", () => {
  resetPmMarketWsSourceModeForTests("changmen"); const first = start(); resetPmMarketWsSourceModeForTests("official");
  const worker = new Port(), client = new WsBookShadowWorkerClient(() => true, () => worker); releases.push(() => client.stop());
  client.setAssets(["1"]); first.frame(raw()); expect(client.report().assets).toBe(0);
  expect(worker.messages.filter(m => m.type === "stream" && m.event.type === "frame")).toHaveLength(0);
});
test("a pending HTTP completion after stream invalidation cancels the worker context without changing the HTTP result", () => {
  const first = start(), worker = new Port(), client = new WsBookShadowWorkerClient(() => true, () => worker); releases.push(() => client.stop());
  client.setAssets(["1"]);
  const finish = beginWsBookShadow({ tokenId: "1", gateway: "https://clob.polymarket.com", tick: false, proxied: false, role: "execute", leg: "1" });
  first.close(); const raw = { price: .5 }; finish(raw, false);
  vi.advanceTimersByTime(16);
  expect(raw).toEqual({ price: .5 }); expect(client.report().samples.at(-1)?.outcome).toBe("epoch_or_route_changed");
  expect(worker.messages.some(m => m.type === "cancel")).toBe(true); expect(client.report().pendingComparisons).toBe(0);
});

test('observer admission failure releases its Worker without disturbing existing stream consumers', () => {
  const first = start(), quotes: unknown[] = [];
  releases.push(onPolymarketMarketQuote(q => quotes.push(q)));
  for (let i = 0; i < 4; i++) releases.push(observePmMarketStream(() => {}));
  const worker = new Port(), client = new WsBookShadowWorkerClient(() => true, () => worker);
  releases.push(() => client.stop());
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(client.report()).toMatchObject({ worker: false, failure: 'stream_observer_unavailable', pendingStream: 0 });
  first.frame(raw()); expect(quotes).toHaveLength(1); expect(first.closed).toBe(0); expect(Socket.instances).toHaveLength(1);
});
