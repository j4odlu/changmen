import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { shouldAllowEmptyWrite } from "../compose/compose_once.js";

describe("shouldAllowEmptyWrite", () => {
  it("allows a targeted end while unrelated active gaps remain unchanged", () => {
    assert.deepEqual(shouldAllowEmptyWrite({ info: [], previousActiveIds: [42, 99],
      processedActiveIds: new Set(), markEndedIds: [42] }), { ok: true, reason: "lifecycle_only" });
    assert.deepEqual(shouldAllowEmptyWrite({ info: [], previousActiveIds: [42, 99],
      processedActiveIds: new Set([42]), endedCount: 1, endedRowIds: [42] }), { ok: true, reason: "lifecycle_only" });
  });
  it("allows nonempty", () => {
    assert.equal(shouldAllowEmptyWrite({ info: [{}], endedCount: 0 }).ok, true);
  });

  it("allows all-ended when every previous active was processed", () => {
    const r = shouldAllowEmptyWrite({
      info: [],
      endedCount: 2,
      processedActiveIds: new Set([10, 11]),
      previousActiveIds: [10, 11],
    });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "all_ended_covered");
  });

  it("rejects empty when previous actives were not in this tick", () => {
    const r = shouldAllowEmptyWrite({
      info: [],
      endedCount: 1,
      processedActiveIds: new Set([10]),
      previousActiveIds: [10, 99, 100],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "empty_but_unprocessed_actives");
    assert.equal(r.uncoveredCount, 2);
  });

  it("rejects disaster empty", () => {
    const r = shouldAllowEmptyWrite({
      info: [],
      endedCount: 0,
      processedActiveIds: new Set(),
      previousActiveIds: [1],
    });
    assert.equal(r.ok, false);
  });

  it("allows empty when markEndedIds covers all previous (sources-gone zombies)", () => {
    const r = shouldAllowEmptyWrite({
      info: [],
      endedCount: 0,
      processedActiveIds: new Set(),
      previousActiveIds: [2008, 2029],
      markEndedIds: [2008, 2029],
    });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "all_sources_gone_covered");
  });

  it("allows empty when endPass + sources-gone marks cover previous", () => {
    const r = shouldAllowEmptyWrite({
      info: [],
      endedCount: 1,
      processedActiveIds: new Set([10]),
      previousActiveIds: [10, 2008],
      markEndedIds: [2008],
    });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "all_ended_covered");
  });

  it("still rejects empty when zombie gap is not marked", () => {
    const r = shouldAllowEmptyWrite({
      info: [],
      endedCount: 1,
      processedActiveIds: new Set([10]),
      previousActiveIds: [10, 99],
      markEndedIds: [],
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "empty_but_unprocessed_actives");
    assert.equal(r.uncoveredCount, 1);
  });

  it("force allows disaster empty", () => {
    assert.equal(
      shouldAllowEmptyWrite({
        info: [],
        endedCount: 0,
        allowEmptyWrite: true,
        previousActiveIds: [1],
      }).ok,
      true,
    );
  });
});
