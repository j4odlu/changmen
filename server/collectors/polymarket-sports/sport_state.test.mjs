import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports, test/no-import-node-test -- Collector tests run with node --test.
import test from "node:test";
import { createPmSportMessageQueue, createPmSportStateWriter, hasPmSportStatus } from "./sport_state.js";
import { sourceEventSnapshot } from "./event_states.ts";

const scheduled = { gameId: 10, eventId: "event-10", status: "not_started", live: false, ended: false };
const running = { ...scheduled, status: "running", live: true, score: "000-000|1-0|Bo3", period: "2/3" };
function fixture(stored = null) {
  let snapshot = stored;
  const writes = [];
  const read = async () => snapshot;
  const write = async (id, next) => { writes.push([id, next]); snapshot = next; return true; };
  return { apply: createPmSportStateWriter(read), read, write, writes };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("Gamma supplies status until WS takes over, then never rolls it back", async () => {
  const f = fixture();
  assert.equal(await f.apply(1, scheduled, "gamma", f.write), true);
  assert.equal(f.writes[0][1].source, "gamma");
  assert.equal(await f.apply(1, running, "gamma", f.write), true);
  assert.equal(await f.apply(1, running, "ws", f.write), true);
  assert.equal(f.writes.at(-1)[1].source, "ws");
  assert.equal(await f.apply(1, scheduled, "gamma", f.write), false);
  assert.equal(f.writes.length, 3);
  assert.equal((await f.read()).status, "running");
  assert.equal(await f.apply(1, { ...running, status: "finished", ended: true }, "ws", f.write), true);
});

test("restart preserves WS ownership and conservatively protects legacy valid states", async () => {
  for (const stored of [{ ...running, source: "ws" }, running]) {
    const f = fixture(stored);
    assert.equal(await f.apply(1, scheduled, "gamma", f.write), false);
    assert.equal(f.writes.length, 0);
    assert.equal(await f.apply(1, running, "ws", f.write), true);
  }
});

test("restart keeps Gamma fallback available for Gamma and missing-status snapshots", async () => {
  for (const stored of [{ ...scheduled, source: "gamma" }, {}, { live: false, ended: false }, null]) {
    const f = fixture(stored);
    assert.equal(await f.apply(1, running, "gamma", f.write), true);
    assert.equal((await f.read()).source, "gamma");
  }
});

test("unknown WS messages do not disable Gamma or erase the last status", async () => {
  const f = fixture();
  assert.equal(await f.apply(1, { gameId: 10, live: false, ended: false }, "ws", f.write), false);
  assert.equal(await f.apply(1, scheduled, "gamma", f.write), true);
  assert.equal(await f.apply(1, { gameId: 10, status: "unknown" }, "ws", f.write), false);
  assert.equal((await f.read()).status, "not_started");
});

test("all documented NBA/CBB statuses reach matched and unmatched event storage", async () => {
  for (const status of ["Scheduled", "InProgress", "Final", "F/OT", "Suspended", "Postponed", "Delayed", "Canceled", "Forfeit", "NotNecessary"]) {
    const message = { gameId: 5127839, eventId: "basketball-native", status, live: false, ended: false };
    assert.equal(hasPmSportStatus(message), true, status);
    const source = sourceEventSnapshot(message, "ws");
    assert.equal(source.status, status);
    assert.equal(source.eventId, "basketball-native");
    const f = fixture();
    assert.equal(await f.apply(1, message, "ws", f.write), true, status);
    assert.equal((await f.read()).status, status);
    assert.equal((await f.read()).ended, ["Final", "F/OT"].includes(status));
    assert.equal(await f.apply(1, scheduled, "gamma", f.write), false);
  }
});

test("a final overtime update replaces the live state and repeated frames deduplicate", async () => {
  const f = fixture();
  const live = { gameId: 5127839, eventId: "basketball-native", status: "InProgress", live: true, ended: false, score: "108-108" };
  assert.equal(await f.apply(1, live, "ws", f.write), true);
  const final = { ...live, status: "F/OT", live: false, score: "110-108" };
  assert.equal(await f.apply(1, final, "ws", f.write), true);
  assert.equal((await f.read()).ended, true);
  assert.equal((await f.read()).label, "已结束 · 110-108");
  assert.equal(await f.apply(1, final, "ws", f.write), false);
  assert.equal(f.writes.length, 2);
});

test("next basketball WS update corrects a stored zero score and keeps deduplication and WS ownership", async () => {
  const message = { gameId: 5127839, status: "InProgress", live: true, ended: false,
    score: "98-94", period: "Q4" };
  const f = fixture({ ...message, source: "ws", scoreRaw: "98-94",
    mapScore: { home: 0, away: 0 }, label: "进行中 · Q4 · 0-0" });
  assert.equal(await f.apply(1, message, "ws", f.write), true);
  assert.deepEqual((await f.read()).mapScore, { home: 98, away: 94 });
  assert.equal((await f.read()).label, "进行中 · Q4 · 98-94");
  assert.equal(await f.apply(1, message, "ws", f.write), false);
  assert.equal(await f.apply(1, scheduled, "gamma", f.write), false);
  assert.equal(f.writes.length, 1);
});

test("Gamma awaiting its initial DB read is discarded when WS arrives", async () => {
  const gate = deferred();
  const writes = [];
  const apply = createPmSportStateWriter(() => gate.promise);
  const write = async (_, snap) => { writes.push(snap); return true; };
  const gamma = apply(1, scheduled, "gamma", write);
  const ws = apply(1, running, "ws", write);
  gate.resolve(null);
  assert.equal(await gamma, false);
  assert.equal(await ws, true);
  assert.deepEqual(writes.map(s => s.source), ["ws"]);
});

test("an in-flight Gamma write completes before WS, so WS remains the final state", async () => {
  const started = deferred();
  const finish = deferred();
  const f = fixture();
  const gamma = f.apply(1, scheduled, "gamma", async (...args) => {
    started.resolve();
    await finish.promise;
    return f.write(...args);
  });
  await started.promise;
  const ws = f.apply(1, running, "ws", f.write);
  finish.resolve();
  assert.equal(await gamma, true);
  assert.equal(await ws, true);
  assert.deepEqual(f.writes.map(([, s]) => s.source), ["gamma", "ws"]);
  assert.equal((await f.read()).status, "running");
});

test("failed WS writes remain retryable and still block Gamma in this process", async () => {
  const f = fixture();
  assert.equal(await f.apply(1, running, "ws", async () => false), false);
  assert.equal(await f.apply(1, scheduled, "gamma", f.write), false);
  await assert.rejects(f.apply(1, running, "ws", async () => { throw new Error("offline"); }), /offline/);
  assert.equal(await f.apply(1, running, "ws", f.write), true);
  assert.equal(await f.apply(1, running, "ws", f.write), false);
  assert.equal(f.writes.length, 1);
});

test("failed initial reads recover on the next update", async () => {
  let reads = 0;
  const apply = createPmSportStateWriter(async () => {
    if (++reads === 1)
      throw new Error("read offline");
    return null;
  });
  await assert.rejects(apply(1, running, "ws", async () => true), /read offline/);
  assert.equal(await apply(1, running, "ws", async () => true), true);
});

test("different client matches do not share ownership even when gameId is reused", async () => {
  const f = fixture();
  const apply = createPmSportStateWriter(async () => null);
  assert.equal(await apply(1, running, "ws", f.write), true);
  assert.equal(await apply(2, scheduled, "gamma", f.write), true);
  assert.deepEqual(f.writes.map(([id]) => id), [1, 2]);
});

test("duplicate frames deduplicate but new identity still gets persisted", async () => {
  const f = fixture();
  assert.equal(await f.apply(1, running, "ws", f.write), true);
  assert.equal(await f.apply(1, running, "ws", f.write), false);
  assert.equal(await f.apply(1, { ...running, slug: "match-slug" }, "ws", f.write), true);
  assert.equal((await f.read()).slug, "match-slug");
});

test("WS receive order is preserved even when the first match resolution is slow", async () => {
  const resolution = deferred();
  const started = deferred();
  const f = fixture();
  const enqueue = createPmSportMessageQueue(async (msg) => {
    if (msg.status === "running") {
      started.resolve();
      await resolution.promise;
    }
    return f.apply(1, msg, "ws", f.write);
  });
  const older = enqueue(running);
  await started.promise;
  const newer = enqueue({ ...running, status: "finished", ended: true });
  resolution.resolve();
  await Promise.all([older, newer]);
  assert.deepEqual(f.writes.map(([, s]) => s.status), ["running", "finished"]);
  assert.equal((await f.read()).ended, true);
});

test("a slow WS match does not block other games and errors do not poison its queue", async () => {
  const finish = deferred();
  const started = deferred();
  const handled = [];
  const enqueue = createPmSportMessageQueue(async (msg) => {
    if (msg.fail) {
      started.resolve();
      await finish.promise;
      throw new Error("resolve failed");
    }
    handled.push(msg.gameId);
  });
  const failed = enqueue({ gameId: 10, fail: true });
  const rejected = assert.rejects(failed, /resolve failed/);
  await started.promise;
  const next = enqueue({ gameId: 10 });
  await enqueue({ gameId: 11 });
  assert.deepEqual(handled, [11]);
  finish.resolve();
  await rejected;
  await next;
  assert.deepEqual(handled, [11, 10]);
});
test("source-event snapshots reuse received state without a client match or guessed start status", () => {
  const snapshot = sourceEventSnapshot({ ...running, eventId: "pm-native", elapsed: 0 }, "ws");
  assert.equal(snapshot.eventId, "pm-native");
  assert.equal(snapshot.source, "ws");
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.elapsed, "0");
  assert.deepEqual(snapshot.mapScore, { home: 1, away: 0 });
  assert.equal(sourceEventSnapshot({ gameId: 10, live: true }, "ws"), null);
  assert.equal(sourceEventSnapshot({ eventId: "pm-native" }, "gamma"), null);
  assert.equal(sourceEventSnapshot({ event_id: "pm-native", status: "scheduled" }, "ws").eventId, "pm-native");
});
