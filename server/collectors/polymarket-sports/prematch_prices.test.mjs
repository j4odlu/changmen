import { test } from "node:test";
import assert from "node:assert/strict";
import { collectPrematchPrices, readPrematchPoint } from "./prematch_prices.js";

const start = Date.parse("2026-10-06T14:30:00Z");
const event = () => ({ markets: [{ id: "m1", sportsMarketType: "child_moneyline", gameStartTime: new Date(start).toISOString(), clobTokenIds: '["a","b"]' }] });
const setup = () => {
  const db = {};
  const calls = [];
  return { db, calls, options: { now: start + 1000, load: async () => db,
    save: async rows => { for (const row of rows) db[row.tokenId] = row; },
    read: async (token, cutoff) => { calls.push([token, cutoff]); return [{ timestamp: cutoff, price: token === "a" ? .435 : .565, resolution_seconds: 0 }]; },
  } };
};

test("persists per-map tokens at start minus one second, reuses DB cache after restart", async () => {
  const { options, db, calls } = setup();
  assert.equal(await collectPrematchPrices(event(), options), 2);
  assert.equal(db.a.price, .435);
  assert.equal(db.b.price, .565);
  assert.equal(db.a.cutoff, start / 1000 - 1);
  assert.equal(await collectPrematchPrices(event(), { ...options, now: start + 60_000 }), 0);
  assert.equal(calls.length, 2);
});

test("changed registered start invalidates old values immediately and waits until new start", async () => {
  const { options, db, calls } = setup();
  await collectPrematchPrices(event(), options);
  const shifted = event();
  shifted.markets[0].gameStartTime = new Date(start + 3600_000).toISOString();
  await collectPrematchPrices(shifted, { ...options, now: start + 60_000 });
  assert.equal(db.a.status, "pending");
  assert.equal(db.a.price, undefined);
  assert.equal(calls.length, 2);
  await collectPrematchPrices(shifted, { ...options, now: start + 3600_000 });
  assert.equal(db.a.status, "ready");
  assert.equal(calls[2][1], (start + 3600_000) / 1000 - 1);
});

test("retry failure preserves a valid same-cutoff observation, uses one-minute backoff", async () => {
  const { options, db } = setup();
  await collectPrematchPrices(event(), options);
  await collectPrematchPrices(event(), { ...options, now: start + 601_000, read: async () => { throw new Error("offline"); } });
  assert.equal(db.a.status, "ready");
  assert.equal(db.a.price, .435);
  assert.equal(db.a.nextCheckAt, start + 661_000);
});

test("invalid and post-cutoff prices never replace missing history with live odds", async () => {
  assert.equal(readPrematchPoint([{ timestamp: 100, price: "", resolution_seconds: 0 }], 100), null);
  assert.equal(readPrematchPoint([{ timestamp: 101, price: .5, resolution_seconds: 0 }], 100), null);
  assert.equal(readPrematchPoint([{ timestamp: 99, price: 0, resolution_seconds: 0 }], 100).price, 0);
  const { options, db } = setup();
  await collectPrematchPrices(event(), { ...options, read: async () => [] });
  assert.equal(db.a.status, "missing");
  assert.equal(db.a.price, undefined);
});
