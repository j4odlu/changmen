import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  PB_SNAPSHOT_ORPHAN_GRACE_MS,
  collectorBetsWriteKey,
  collectorMatchesWriteKey,
  collectorTimersWriteKey,
  isStickyPlatformMatchSnapshot,
  platformMatchOrphanCutoffMs,
  resolveSnapshotOrphanBeforeMs,
  shouldIgnoreEmptyPlatformMatchSnapshot,
} from "./platform_collector_store.js";
import {
  __offerRdsWriteForTests,
  __resetRdsWriteQueueForTests,
  getRdsWriteQueueStats,
} from "./common.js";

describe("sticky platform_matches snapshot (PB/OB/RAY)", () => {
  it("marks PB/OB/RAY as sticky", () => {
    assert.equal(isStickyPlatformMatchSnapshot("PB"), true);
    assert.equal(isStickyPlatformMatchSnapshot("OB"), true);
    assert.equal(isStickyPlatformMatchSnapshot("RAY"), true);
    assert.equal(isStickyPlatformMatchSnapshot("Polymarket"), false);
    assert.equal(isStickyPlatformMatchSnapshot("IA"), false);
  });

  it("ignores empty snapshot for Polymarket and sticky venues", () => {
    assert.equal(shouldIgnoreEmptyPlatformMatchSnapshot("PB"), true);
    assert.equal(shouldIgnoreEmptyPlatformMatchSnapshot("OB"), true);
    assert.equal(shouldIgnoreEmptyPlatformMatchSnapshot("RAY"), true);
    assert.equal(shouldIgnoreEmptyPlatformMatchSnapshot("Polymarket"), true);
    assert.equal(shouldIgnoreEmptyPlatformMatchSnapshot("IA"), false);
  });

  it("sticky orphan cutoff is now - grace; others immediate", () => {
    const now = 1_700_000_000_000;
    const grace = now - PB_SNAPSHOT_ORPHAN_GRACE_MS;
    assert.equal(platformMatchOrphanCutoffMs("PB", now), grace);
    assert.equal(platformMatchOrphanCutoffMs("OB", now), grace);
    assert.equal(platformMatchOrphanCutoffMs("RAY", now), grace);
    assert.equal(platformMatchOrphanCutoffMs("IA", now), null);
    assert.equal(PB_SNAPSHOT_ORPHAN_GRACE_MS, 5 * 60 * 1000);
  });

  it("resolveSnapshotOrphanBeforeMs does not treat null as 0", () => {
    assert.equal(resolveSnapshotOrphanBeforeMs(null), null);
    assert.equal(resolveSnapshotOrphanBeforeMs(undefined), null);
    assert.equal(resolveSnapshotOrphanBeforeMs(""), null);
    assert.equal(resolveSnapshotOrphanBeforeMs("x"), null);
    assert.equal(resolveSnapshotOrphanBeforeMs(0), 0);
    assert.equal(resolveSnapshotOrphanBeforeMs(42), 42);
  });
});

describe("collector RDS write keys", () => {
  it("splits matches / per-match bets / timers so SaveBet batch does not coalesce", () => {
    assert.equal(collectorMatchesWriteKey("PB"), "collector:PB:matches");
    assert.equal(collectorBetsWriteKey("PB", "1633801688"), "collector:PB:bets:1633801688");
    assert.equal(collectorTimersWriteKey("PB"), "collector:PB:timers");
    assert.notEqual(
      collectorMatchesWriteKey("PB"),
      collectorBetsWriteKey("PB", "1"),
    );
    assert.notEqual(
      collectorBetsWriteKey("PB", "1"),
      collectorBetsWriteKey("PB", "2"),
    );

    __resetRdsWriteQueueForTests({ queueMax: 50, concurrency: 0 });
    __offerRdsWriteForTests({ key: collectorMatchesWriteKey("PB"), fn: () => {} });
    __offerRdsWriteForTests({ key: collectorBetsWriteKey("PB", "1"), fn: () => {} });
    __offerRdsWriteForTests({ key: collectorBetsWriteKey("PB", "2"), fn: () => {} });
    __offerRdsWriteForTests({ key: collectorBetsWriteKey("PB", "1"), fn: () => {} });
    const st = getRdsWriteQueueStats();
    assert.equal(st.pending, 3);
    assert.equal(st.coalesced, 1);
    assert.equal(st.dropped, 0);
    __resetRdsWriteQueueForTests();
  });
});
