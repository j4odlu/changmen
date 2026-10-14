import assert from "node:assert/strict";
import { it } from "vitest";
import { gateway } from "./fok-notification-fixture.mjs";

function business(result) {
  return { result: result.result, queued: result.queued.map(({ accountLine: _line, detailHtml: _html, ...task }) => task), events: result.trace.filter(event => !["loading", "close", "result_notice"].includes(event)) };
}
for (const provider of ["OB", "RAY", "Polymarket"]) {
  for (const outcome of ["accepted", "rejected", "throw", "pending"]) {
    it(`${provider}/${outcome}: each notification fault preserves the submission and business trace`, async () => {
      const normal = await gateway(null, provider, null, { outcome });
      for (const failure of ["loading", "close", "result", "format"]) {
        const faulty = await gateway(null, provider, failure, { outcome });
        assert.deepEqual(business(faulty), business(normal));
        assert.equal(faulty.trace.filter(event => event.bet).length, 1, "one POST, no notification retry");
      }
      assert.equal(normal.result.success, !["rejected", "throw"].includes(outcome));
      assert.equal(normal.result.pending, outcome === "pending");
      assert.equal(normal.trace.filter(event => event === "pm_reject_save").length, provider === "Polymarket" && outcome === "rejected" ? 1 : 0);
      assert.equal(normal.trace.filter(event => event === "pm_matched_save").length, provider === "Polymarket" && outcome === "accepted" ? 1 : 0);
      assert.equal(normal.trace.filter(event => event === "sound").length, outcome === "accepted" ? 1 : 0);
      assert.equal(normal.queued.length, outcome === "pending" && provider !== "OB" ? 1 : 0);
    });
  }
  it(`${provider}: unprepared quote never posts, even with broken notification`, async () => {
    for (const failure of [null, "loading", "close", "result", "format"]) {
      const result = await gateway(null, provider, failure, { unprepared: true });
      assert.equal(result.result.success, false);
      assert.equal(result.trace.filter(event => event.bet).length, 0);
      assert.equal(result.queued.length, 0);
    }
  });
  it(`${provider}: formatting error preserves one prepared POST and the receipt`, async () => {
    const result = await gateway(null, provider, "format");
    assert.equal(result.error, undefined);
    assert.equal(result.result.success, true);
    assert.equal(result.trace.filter(event => event.bet).length, 1);
  });
}
for (const provider of ["RAY", "Polymarket"]) {
  for (const confirmation of ["filled", "rejected", "pending", "throw"]) {
    it(`${provider}: terminal ${confirmation} notice faults preserve confirmation and success marking`, async () => {
      const normal = await gateway(null, provider, null, { outcome: "pending", confirmation });
      for (const failure of [null, "loading", "close", "result", "terminal"]) {
        const current = await gateway(null, provider, failure, { outcome: "pending", confirmation });
        assert.deepEqual(business(current), business(normal));
        assert.equal(current.trace.filter(event => event.bet).length, 1);
        assert.equal(current.trace.filter(event => event === "confirm_read").length, 1);
        assert.equal(current.trace.filter(event => event === "mark").length, confirmation === "filled" ? 1 : 0);
        assert.equal(current.trace.filter(event => event === "balance").length, ["filled", "rejected"].includes(confirmation) ? 1 : 0);
      }
    });
  }
  it(`${provider}: original loseOrder/defer confirmation gates survive notification failure`, async () => {
    for (const scenario of [{ loseOrder: true }, { deferPostAcceptSettlement: true }]) {
      for (const failure of [null, "loading", "close", "result"]) {
        const result = await gateway(null, provider, failure, { outcome: "pending", ...scenario });
        assert.equal(result.trace.filter(event => event.bet).length, 1);
        assert.equal(result.queued.length, 0);
        assert.equal(result.trace.some(event => event.confirmation_timer), false);
      }
    }
  });
}
