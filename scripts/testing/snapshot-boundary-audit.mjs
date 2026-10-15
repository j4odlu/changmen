import assert from "node:assert/strict";
import { test } from "node:test";
import { createVersionedSnapshotCache } from "../../server/db/versioned_snapshot_cache.js";

function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const snapshot = version => ({ version, rows: [{ id: "9007199254740993", reverse: ["OB"], pm_sport: { price: 2 } }] });

await test("repeated invalidation during the meta probe delivers only the current generation to every caller", async () => {
  const oldMeta = gate(), entered = gate(); let reads = 0;
  const cache = createVersionedSnapshotCache({
    readMeta: async () => { if (++reads === 1) { entered.resolve(); return oldMeta.promise; } return { version: "new" }; },
    readSnapshot: async () => snapshot("new"),
  });
  const first = cache.load(); await entered.promise;
  cache.invalidate(); const second = cache.load(); cache.invalidate(); const third = cache.load();
  oldMeta.resolve({ version: "old" });
  const values = await Promise.all([first, second, third]);
  assert(values.every(value => value.version === "new"));
  values[0].rows[0].pm_sport.price = 999;
  assert.equal(values[1].rows[0].pm_sport.price, 2);
  assert.equal(cache.peek().rows[0].pm_sport.price, 2);
  assert.equal(cache.peek().rows[0].id, "9007199254740993");
});

await test("a second invalidation while reloading prevents both older row snapshots from being delivered", async () => {
  const firstRead = gate(), secondRead = gate(), firstEntered = gate(), secondEntered = gate(); let reads = 0;
  const cache = createVersionedSnapshotCache({ readMeta: async () => null, readSnapshot: async () => {
    if (++reads === 1) { firstEntered.resolve(); return firstRead.promise; }
    if (reads === 2) { secondEntered.resolve(); return secondRead.promise; }
    return snapshot("final");
  } });
  const first = cache.load(); await firstEntered.promise;
  cache.invalidate(); const second = cache.load(); firstRead.resolve(snapshot("old"));
  await secondEntered.promise; cache.invalidate(); const third = cache.load(); secondRead.resolve(snapshot("intermediate"));
  const results = await Promise.all([first, second, third]);
  assert(results.every(result => result.version === "final"));
  assert.equal(cache.peek().version, "final");
});

await test("a rejected shared read rejects all waiters, clears the flight and allows the next load", async () => {
  const failed = gate(), entered = gate(); let calls = 0;
  const cache = createVersionedSnapshotCache({ readMeta: async () => null, readSnapshot: async () => {
    if (++calls === 1) { entered.resolve(); return failed.promise; }
    return snapshot("recovered");
  } });
  const first = cache.load(), second = cache.load();
  const outcomes = Promise.allSettled([first, second]);
  await entered.promise; failed.reject(new Error("audit snapshot failure"));
  assert((await outcomes).every(result => result.status === "rejected" && /snapshot failure/.test(result.reason.message)));
  assert.equal(cache.peek(), null);
  assert.equal((await cache.load()).version, "recovered");
});

await test("invalidation plus database outage cannot deliver the old snapshot or treat failure as confirmed empty", async () => {
  let source = snapshot("old");
  const cache = createVersionedSnapshotCache({ readMeta: async () => null, readSnapshot: async () => source });
  await cache.load(); cache.invalidate(); source = null;
  assert.equal(await cache.load(), null); assert.equal(cache.peek(), null);
  source = { version: "empty", rows: [] };
  assert.deepEqual(await cache.load(), source);
  cache.invalidate(); source = snapshot("recovered");
  assert.equal((await cache.load()).version, "recovered");
});

await test("malformed rows are rejected without poisoning the prior cache, and the next load can recover", async () => {
  let source = snapshot("good");
  const cache = createVersionedSnapshotCache({ readMeta: async () => null, readSnapshot: async () => source });
  await cache.load(); source = { version: "bad", rows: null };
  await assert.rejects(cache.load(), /Invalid client match snapshot/);
  assert.equal(cache.peek().version, "good");
  source = snapshot("recovered");
  assert.equal((await cache.load()).version, "recovered");
});
