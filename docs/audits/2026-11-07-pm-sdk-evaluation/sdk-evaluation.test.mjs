import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const packageEntry = process.env.PM_SDK_EVAL_ENTRY || pathToFileURL(createRequire(import.meta.url).resolve("@polymarket/client")).href;
const packageVersion = JSON.parse(fs.readFileSync(new URL("../package.json", packageEntry), "utf8")).version;
if (packageVersion !== (process.env.PM_SDK_EVAL_VERSION || "0.12.0")) throw new Error(`Unexpected SDK version ${packageVersion}`);
console.log(JSON.stringify({ sdkVersion: packageVersion, entry: packageEntry, network: "memory sockets only" }));
const { createPublicClient, forkEnvironmentConfig, production } = await import(
  process.env.PM_SDK_EVAL_ENTRY || "@polymarket/client"
);

// Evaluation only. Never installed into the application or connected to the network.
class FakeSocket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];
  static autoOpen = true;
  static replyPong = true;
  readyState = 0;
  sent = [];
  constructor(url) {
    super(); this.url = String(url); FakeSocket.instances.push(this);
    if (FakeSocket.autoOpen) queueMicrotask(() => this.open());
  }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1006, reason: "evaluation" }));
  }
  error() { this.dispatchEvent(new Event("error")); }
  send(text) {
    this.sent.push(text);
    if (text === "PING" && FakeSocket.replyPong) this.text("PONG");
  }
  text(data) { this.dispatchEvent(Object.assign(new Event("message"), { data })); }
  frame(value) { this.text(JSON.stringify(value)); }
  frames() { return this.sent.filter(x => x !== "PING").map(x => JSON.parse(x)); }
}
const market = `0x${"1".repeat(64)}`;
const handles = [];
const spec = (...assetIds) => [{ topic: "market", assetIds, customFeatureEnabled: true }];
const bbo = (asset = "101", ask = "0.35") => ({ event_type: "best_bid_ask", asset_id: asset,
  market, best_bid: "0.34", best_ask: ask, spread: "0.01", timestamp: "1793983121679" });
async function subscribe(client, ...ids) {
  const handle = await client.subscribe(spec(...ids)); handles.push(handle); return handle;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("WebSocket", FakeSocket);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  FakeSocket.instances = []; FakeSocket.autoOpen = true; FakeSocket.replyPong = true;
});
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
  for (const socket of FakeSocket.instances) socket.close();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("initial union, duplicate assets, shared references and incremental frames use one socket", async () => {
  const client = createPublicClient();
  const one = await subscribe(client, "101", "202");
  const socket = FakeSocket.instances[0];
  expect(socket.frames()[0]).toEqual({ assets_ids: ["101", "202"], custom_feature_enabled: true, type: "market" });
  const duplicate = await subscribe(client, "202");
  expect(socket.frames()).toHaveLength(1);
  const two = await subscribe(client, "202", "303");
  expect(socket.frames().at(-1)).toEqual({ assets_ids: ["303"], custom_feature_enabled: true, operation: "subscribe" });
  await one.close();
  expect(socket.frames().at(-1)).toEqual({ assets_ids: ["101"], operation: "unsubscribe" });
  await duplicate.close();
  expect(socket.frames().at(-1)).toEqual({ assets_ids: ["101"], operation: "unsubscribe" });
  expect(FakeSocket.instances).toHaveLength(1);
  await two.close(); expect(socket.readyState).toBe(3);
});

it("a new desired-set handle can be acquired before closing the old handle without resubscribing retained assets", async () => {
  const client = createPublicClient(); const previous = await subscribe(client, "101", "202");
  const next = await subscribe(client, "202", "303");
  await previous.close();
  expect(FakeSocket.instances).toHaveLength(1);
  expect(FakeSocket.instances[0].frames().slice(1)).toEqual([
    { assets_ids: ["303"], custom_feature_enabled: true, operation: "subscribe" },
    { assets_ids: ["101"], operation: "unsubscribe" },
  ]);
  const event = next[Symbol.asyncIterator]().next();
  FakeSocket.instances[0].frame(bbo("303"));
  expect((await event).value.payload.bestAsk).toBe("0.35");
});

it("normalizes BBO fields, filters unrelated assets and ignores malformed input", async () => {
  const handle = await subscribe(createPublicClient(), "101");
  const pending = handle[Symbol.asyncIterator]().next(); const socket = FakeSocket.instances[0];
  socket.text("{invalid"); socket.frame(bbo("999")); socket.frame(bbo());
  const event = (await pending).value;
  expect(event).toMatchObject({ topic: "market", type: "best_bid_ask", payload: { assetId: "101", bestAsk: "0.35" } });
  expect(event).not.toHaveProperty("event_type");
});

it("delivers a price_change-only initial quote and its source timestamp", async () => {
  const handle = await subscribe(createPublicClient(), "101");
  const pending = handle[Symbol.asyncIterator]().next();
  FakeSocket.instances[0].frame({ event_type: "price_change", market, timestamp: "1793983121679",
    price_changes: [{ asset_id: "101", price: "0.35", size: "10", side: "SELL", best_bid: "0.34", best_ask: "0.35" }] });
  expect((await pending).value).toMatchObject({ type: "price_change", payload: {
    timestamp: 1793983121679, priceChanges: [{ assetId: "101", bestAsk: "0.35" }],
  } });
});

it("preserves an explicitly empty asks snapshot for application-side clearing", async () => {
  const handle = await subscribe(createPublicClient(), "101");
  const pending = handle[Symbol.asyncIterator]().next();
  FakeSocket.instances[0].frame({ event_type: "book", market, asset_id: "101", timestamp: "1793983121679", bids: [], asks: [] });
  expect((await pending).value).toMatchObject({ type: "book", payload: { assetId: "101", asks: [] } });
});

it("does not turn a best_ask of 1 into an application-side clear operation", async () => {
  const handle = await subscribe(createPublicClient(), "101");
  const pending = handle[Symbol.asyncIterator]().next(); FakeSocket.instances[0].frame(bbo("101", "1"));
  expect((await pending).value.payload.bestAsk).toBe("1");
});

it("normalizes tick-size control events", async () => {
  const handle = await subscribe(createPublicClient(), "101");
  const pending = handle[Symbol.asyncIterator]().next();
  FakeSocket.instances[0].frame({ event_type: "tick_size_change", market, asset_id: "101",
    old_tick_size: "0.01", new_tick_size: "0.001", timestamp: "1793983121679" });
  expect((await pending).value).toMatchObject({ type: "tick_size_change", payload: {
    assetId: "101", newTickSize: "0.001", timestamp: 1793983121679,
  } });
});

it("sends PING every 10 seconds; a quiet market with PONG does not reconnect", async () => {
  await subscribe(createPublicClient(), "101");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeSocket.instances).toHaveLength(1);
  expect(FakeSocket.instances[0].sent.filter(x => x === "PING")).toHaveLength(6);
});

it("reconnects on stale heartbeat and restores the active union", async () => {
  await subscribe(createPublicClient(), "101"); FakeSocket.replyPong = false;
  await vi.advanceTimersByTimeAsync(35_000);
  expect(FakeSocket.instances[0].readyState).toBe(3);
  FakeSocket.replyPong = true; await vi.advanceTimersByTimeAsync(1_000);
  expect(FakeSocket.instances).toHaveLength(2);
  expect(FakeSocket.instances[1].frames()[0].assets_ids).toEqual(["101"]);
});

it("keeps the public iterator alive through reconnect without emitting connection status", async () => {
  const handle = await subscribe(createPublicClient(), "101");
  let settled = false;
  const pending = handle[Symbol.asyncIterator]().next().then(x => { settled = true; return x; });
  const old = FakeSocket.instances[0]; old.close();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(FakeSocket.instances).toHaveLength(2); expect(settled).toBe(false);
  old.frame(bbo("101", "0.20")); expect(settled).toBe(false);
  FakeSocket.instances[1].frame(bbo("101", "0.36"));
  expect((await pending).value.payload.bestAsk).toBe("0.36");
});

it("closing the last handle ends its iterator and stops reconnecting", async () => {
  const handle = await subscribe(createPublicClient(), "101");
  const pending = handle[Symbol.asyncIterator]().next();
  await handle.close(); expect((await pending).done).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeSocket.instances).toHaveLength(1);
});

it("a public Promise.race deadline does not cancel a silent SDK handshake", async () => {
  FakeSocket.autoOpen = false;
  const client = createPublicClient();
  const pending = client.subscribe(spec("101")); let settled = false;
  void pending.then(() => { settled = true; });
  const decision = Promise.race([pending.then(() => "subscribed"), new Promise(resolve => setTimeout(() => resolve("deadline"), 15_000))]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await decision).toBe("deadline"); expect(settled).toBe(false);
  expect(FakeSocket.instances[0].readyState).toBe(0);
  // A late open can still subscribe even after an application would have fallen back.
  FakeSocket.instances[0].open(); const handle = await pending; handles.push(handle);
  expect(FakeSocket.instances[0].frames()[0].assets_ids).toEqual(["101"]);
});

it("close can remain pending until the native close event; racing it does not dispose the socket", async () => {
  const handle = await subscribe(createPublicClient(), "101"); const socket = FakeSocket.instances[0];
  const original = socket.close.bind(socket); socket.close = () => { socket.readyState = 2; };
  let closed = false; const pending = handle.close().then(() => { closed = true; });
  await vi.advanceTimersByTimeAsync(60_000); expect(closed).toBe(false);
  socket.close = original; socket.close(); await pending; expect(closed).toBe(true);
});

it("the public environment fork can choose an endpoint, but does not prove relay protocol compatibility", async () => {
  const environment = forkEnvironmentConfig({ name: "offline-sdk-evaluation", clob: {
    market: { ws: "wss://evaluation.invalid/market" },
  } }, production);
  await subscribe(createPublicClient({ environment }), "101");
  expect(FakeSocket.instances[0].url).toBe("wss://evaluation.invalid/market");
});
