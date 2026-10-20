import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import {
  __offerRdsWriteForTests,
  __resetRdsWriteQueueForTests,
  getRdsWriteQueueStats,
} from "./common.js";

afterEach(() => {
  __resetRdsWriteQueueForTests();
});

describe("RDS write queue coalesce (W1)", () => {
  it("same key replaces pending item and increments coalesced", () => {
    __resetRdsWriteQueueForTests({ queueMax: 10, concurrency: 0 });
    __offerRdsWriteForTests({
      key: "collector:PM",
      label: "platform_bets",
      fn: () => {},
    });
    __offerRdsWriteForTests({
      key: "collector:PM",
      label: "platform_bets",
      fn: () => {},
    });
    const st = getRdsWriteQueueStats();
    assert.equal(st.pending, 1);
    assert.equal(st.coalesced, 1);
    assert.equal(st.dropped, 0);
  });

  it("full queue + same key still coalesces (does not drop latest)", () => {
    __resetRdsWriteQueueForTests({ queueMax: 2, concurrency: 0 });
    __offerRdsWriteForTests({ key: "a", fn: () => {} });
    __offerRdsWriteForTests({ key: "b", fn: () => {} });
    assert.equal(getRdsWriteQueueStats().pending, 2);

    __offerRdsWriteForTests({ key: "a", fn: () => {} });
    const st = getRdsWriteQueueStats();
    assert.equal(st.pending, 2);
    assert.equal(st.coalesced, 1);
    assert.equal(st.dropped, 0);
  });

  it("drains coalesced latest after in-flight same key finishes", async () => {
    const calls = [];
    let release;
    const gate = new Promise((r) => { release = r; });

    __resetRdsWriteQueueForTests({ queueMax: 10, concurrency: 1 });
    __offerRdsWriteForTests({
      key: "collector:PM",
      fn: async () => {
        calls.push("inflight");
        await gate;
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(getRdsWriteQueueStats().active, 1);

    __offerRdsWriteForTests({
      key: "collector:PM",
      fn: async () => { calls.push("pending-old"); },
    });
    __offerRdsWriteForTests({
      key: "collector:PM",
      fn: async () => { calls.push("pending-new"); },
    });
    assert.equal(getRdsWriteQueueStats().pending, 1);
    assert.equal(getRdsWriteQueueStats().coalesced, 1);

    release();
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(calls, ["inflight", "pending-new"]);
    assert.equal(getRdsWriteQueueStats().dropped, 0);
  });

  it("full queue without coalesce twin drops the new write", () => {
    __resetRdsWriteQueueForTests({ queueMax: 2, concurrency: 0 });
    __offerRdsWriteForTests({ key: "a", fn: () => {} });
    __offerRdsWriteForTests({ key: "b", fn: () => {} });
    __offerRdsWriteForTests({ key: "c", fn: () => {} });
    const st = getRdsWriteQueueStats();
    assert.equal(st.pending, 2);
    assert.equal(st.dropped, 1);
    assert.equal(st.coalesced, 0);
  });

  it("full queue without key drops the new write", () => {
    __resetRdsWriteQueueForTests({ queueMax: 1, concurrency: 0 });
    __offerRdsWriteForTests({ fn: () => {} });
    __offerRdsWriteForTests({ fn: () => {} });
    const st = getRdsWriteQueueStats();
    assert.equal(st.pending, 1);
    assert.equal(st.dropped, 1);
  });

  it("attributes drops per label in droppedByLabel (P0-1 可观测)", () => {
    __resetRdsWriteQueueForTests({ queueMax: 1, concurrency: 0 });
    __offerRdsWriteForTests({ fn: () => {}, label: "client_matches" }); // 占满队列
    __offerRdsWriteForTests({ fn: () => {}, label: "client_matches" }); // drop
    __offerRdsWriteForTests({ fn: () => {}, label: "platform_bets" }); // drop
    __offerRdsWriteForTests({ fn: () => {} }); // drop → (no-label)
    const st = getRdsWriteQueueStats();
    assert.equal(st.dropped, 3);
    assert.deepEqual(st.droppedByLabel, {
      "client_matches": 1,
      "platform_bets": 1,
      "(no-label)": 1,
    });
  });
});
