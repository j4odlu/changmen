// Offline audit of the installed SDK public API. No network, wallet or orders.
// Run from the repository root: node docs/audits/2026-11-07-pm-direct-price/sdk-smoke.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const sdkRoot = new URL("node_modules/@polymarket/client/", root);
const sdkPackage = JSON.parse(fs.readFileSync(new URL("package.json", sdkRoot), "utf8"));
assert.equal(sdkPackage.version, "0.12.0", "Re-audit a changed SDK version explicitly");
const sourceHashes = [];
for (const mapName of ["index.js.map", "chunk-5JHFOBBZ.js.map"]) {
  const map = JSON.parse(fs.readFileSync(new URL(`dist/${mapName}`, sdkRoot), "utf8"));
  map.sources.forEach((source, i) => {
    if (!/\/websockets\/(?:clob\/(?:market|protocol)|heartbeat|lifecycle)\.ts$|\/actions\/subscriptions\.ts$/.test(source)) return;
    sourceHashes.push({ source, sha256: crypto.createHash("sha256").update(map.sourcesContent[i]).digest("hex") });
  });
}

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;
  static instances = [];
  static onNext;
  readyState = 0;
  sent = [];
  constructor(url) {
    super();
    this.url = url;
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      FakeSocket.onNext?.(this);
      FakeSocket.onNext = undefined;
    });
  }
  send(text) { this.sent.push(text); }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1006, reason: "offline-audit" }));
  }
  message(data) { this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(data) })); }
}

async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Audit timeout")), 2_000);
    })]);
  } finally { clearTimeout(timer); }
}

const originalWebSocket = globalThis.WebSocket;
globalThis.WebSocket = FakeSocket;
const handles = [];
try {
  const { createPublicClient } = await import(new URL("dist/index.js", sdkRoot).href);
  const client = createPublicClient();
  const first = await client.subscribe([{ topic: "market", assetIds: ["101"], customFeatureEnabled: true }]);
  handles.push(first);
  assert.equal(FakeSocket.instances.length, 1);
  const socket = FakeSocket.instances[0];
  assert.equal(JSON.parse(socket.sent[0]).type, "market");
  assert.deepEqual(JSON.parse(socket.sent[0]).assets_ids, ["101"]);
  const duplicate = await client.subscribe([{ topic: "market", assetIds: ["101"], customFeatureEnabled: true }]);
  handles.push(duplicate);
  assert.equal(socket.sent.length, 1);
  const second = await client.subscribe([{ topic: "market", assetIds: ["202"], customFeatureEnabled: true }]);
  handles.push(second);
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(JSON.parse(socket.sent.at(-1)).operation, "subscribe");
  assert.deepEqual(JSON.parse(socket.sent.at(-1)).assets_ids, ["202"]);
  socket.message({ event_type: "best_bid_ask", asset_id: "101", market: `0x${"1".repeat(64)}`,
    best_bid: "0.34", best_ask: "0.40", spread: "0.06", timestamp: "1793983121679" });
  const event = (await deadline(first[Symbol.asyncIterator]().next())).value;
  assert.equal(event.type, "best_bid_ask");
  assert.equal(event.payload.bestAsk, "0.40");
  await second.close();
  assert.equal(JSON.parse(socket.sent.at(-1)).operation, "unsubscribe");
  assert.deepEqual(JSON.parse(socket.sent.at(-1)).assets_ids, ["202"]);
  const nextConnection = new Promise(resolve => { FakeSocket.onNext = resolve; });
  socket.close();
  const reconnected = await deadline(nextConnection);
  assert.equal(JSON.parse(reconnected.sent[0]).type, "market");
  assert.deepEqual(JSON.parse(reconnected.sent[0]).assets_ids, ["101"]);

  const guardPath = new URL("client/packages/venue-browser/polymarket/liveQuoteState.ts", root);
  const guard = await import(guardPath.href);
  guard.resetPolymarketLiveQuoteTsForTests();
  const exchangeNow = Date.now();
  guard.notePolymarketLiveBookQuote("audit-only", exchangeNow + 5_000);
  const acceptsCurrentExchangeTime = guard.shouldApplyPolymarketWsQuote("audit-only", exchangeNow);
  assert.equal(acceptsCurrentExchangeTime, false);
  guard.resetPolymarketLiveQuoteTsForTests();
  console.log(JSON.stringify({
    sdk: sdkPackage.version,
    network: "mocked; no network or orders",
    passedSdkChecks: ["one shared socket", "initial market frame", "duplicate asset sends no frame",
      "incremental subscribe", "normalized BBO event", "incremental unsubscribe", "automatic reconnect and resubscribe"],
    normalizedEvent: { type: event.type, assetId: event.payload.assetId, bestAsk: event.payload.bestAsk },
    clockGuard: { simulatedClientClockAheadMs: 5_000, acceptsCurrentExchangeTime,
      sourceSha256: crypto.createHash("sha256").update(fs.readFileSync(fileURLToPath(guardPath))).digest("hex") },
    sourceHashes,
    limits: ["No actual network or browser latency measured", "Heartbeat behavior reviewed in source, not time-advanced here",
      "No claim of production SDK integration compatibility"],
  }, null, 2));
} finally {
  for (const handle of handles) await handle.close();
  globalThis.WebSocket = originalWebSocket;
}
