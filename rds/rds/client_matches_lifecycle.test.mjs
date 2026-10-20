import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  normalizeClientMatchesWritePayload,
  resolveLifecycleMarkIds,
} from "./client_matches_store.js";

describe("M1 client_matches end patch authority", () => {
  it("resolveLifecycleMarkIds only keeps explicit ids not in active set", () => {
    assert.deepEqual(
      resolveLifecycleMarkIds([10, 20, 10, "x"], new Set([20, 30])),
      [10],
    );
    assert.deepEqual(
      resolveLifecycleMarkIds([], new Set([1, 2])),
      [],
    );
  });

  it("object payload does not invent markEnded from missing actives", () => {
    const payload = normalizeClientMatchesWritePayload({
      activeRows: [{ id: 1, title: "a", matchs: { OB: "1" }, built_at: 1 }],
      endedRows: [],
      markEndedIds: [],
      builtAt: 100,
    }, 100);
    assert.deepEqual(payload.markEndedIds, []);
    assert.equal(payload.activeRows.length, 1);
    assert.equal(payload.endedRows.length, 0);
  });

  it("object payload keeps explicit markEndedIds that are not active/ended", () => {
    const payload = normalizeClientMatchesWritePayload({
      activeRows: [{ id: 1, title: "a", matchs: {}, built_at: 1 }],
      endedRows: [{ id: 2, title: "b", matchs: {}, ended_at: 50, built_at: 1 }],
      markEndedIds: [3, 1, 2],
      builtAt: 100,
    }, 100);
    assert.deepEqual(payload.markEndedIds, [3]);
    assert.equal(payload.endedRows[0].ended_at, 50);
  });

  it("endedRows carry ended_at for lifecycle upsert", () => {
    const payload = normalizeClientMatchesWritePayload({
      activeRows: [],
      endedRows: [{ id: 9, title: "done", matchs: { OB: "o" }, built_at: 1 }],
      markEndedIds: [],
      builtAt: 777,
    }, 777);
    assert.equal(payload.endedRows.length, 1);
    assert.equal(payload.endedRows[0].ended_at, 777);
    assert.deepEqual(payload.markEndedIds, []);
  });
});
