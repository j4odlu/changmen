import { describe, expect, it, vi } from "vitest";
import { createVersionedSnapshotCache } from "./versioned_snapshot_cache.js";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const snap = (version, rows = [{ id: 1, pm_sport: { price: 2 } }]) => ({ version, rows });
describe("committed client match snapshot cache", () => {
  it("uses the version read with rows, even if the initial meta probe was older", async () => {
    const readMeta = vi.fn().mockResolvedValue({ version: "A" });
    const readSnapshot = vi.fn().mockResolvedValue(snap("B"));
    const cache = createVersionedSnapshotCache({ readMeta, readSnapshot });
    expect((await cache.load()).version).toBe("B");
    readMeta.mockResolvedValue({ version: "B" });
    const copy = await cache.load(); copy.rows[0].pm_sport.price = 999;
    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(cache.peek().rows[0].pm_sport.price).toBe(2);
  });
  it("coalesces concurrent callers and caches confirmed empty snapshots", async () => {
    const meta = deferred(); const readMeta = vi.fn(() => meta.promise);
    const readSnapshot = vi.fn().mockResolvedValue(snap("empty", []));
    const cache = createVersionedSnapshotCache({ readMeta, readSnapshot });
    const one = cache.load(), two = cache.load(); meta.resolve({ version: "empty" });
    expect(await one).toEqual(await two);
    await cache.load();
    expect(readMeta).toHaveBeenCalledTimes(2);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });
  it("fences an old in-flight row read after a committed mutation invalidates it", async () => {
    const old = deferred(); const started = deferred();
    const readSnapshot = vi.fn().mockImplementationOnce(() => { started.resolve(); return old.promise; })
      .mockResolvedValue(snap("new", []));
    const cache = createVersionedSnapshotCache({ readMeta: async () => ({ version: "new" }), readSnapshot });
    const request = cache.load(); await started.promise;
    cache.invalidate(); old.resolve(snap("old"));
    expect(await request).toEqual(snap("new", []));
    expect(cache.peek().version).toBe("new");
  });
  it("reloads same-count/same-builtAt PM and manual changes using opaque row versions", async () => {
    let state = snap("A"); const readSnapshot = vi.fn(async () => state);
    const cache = createVersionedSnapshotCache({ readMeta: async () => ({ version: state.version }), readSnapshot });
    await cache.load(); state = snap("B", [{ id: 1, reverse: ["OB"], pm_sport: { price: 3 } }]);
    expect((await cache.load()).rows[0].reverse).toEqual(["OB"]);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });
  it("fences invalidation between refresh completion and delivery to a waiting caller", async () => {
    const old = deferred(); const entered = deferred();
    const cache = createVersionedSnapshotCache({ readMeta: async () => null,
      readSnapshot: vi.fn().mockImplementationOnce(() => { entered.resolve(); return old.promise; })
        .mockResolvedValue(snap("new", [])) });
    const request = cache.load(); await entered.promise;
    old.resolve(snap("old"));
    await Promise.resolve(); // refresh has published, its waiting callers have not resumed
    cache.invalidate();
    expect(await request).toEqual(snap("new", []));
  });
  it("does not label failed reads successful, and retries after failure", async () => {
    let available = true;
    const cache = createVersionedSnapshotCache({ readMeta: async () => null,
      readSnapshot: async () => available ? snap("A") : null });
    await cache.load(); available = false;
    expect((await cache.load()).version).toBe("A");
    cache.invalidate(); expect(await cache.load()).toBeNull();
    available = true; expect((await cache.load()).version).toBe("A");
  });
  it("forces a row refresh when the age limit expires", async () => {
    let time = 0; const readSnapshot = vi.fn().mockResolvedValue(snap("A"));
    const cache = createVersionedSnapshotCache({ readMeta: async () => ({ version: "A" }),
      readSnapshot, maxAgeMs: 10, now: () => time });
    await cache.load(); time = 11; await cache.load();
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });
});
