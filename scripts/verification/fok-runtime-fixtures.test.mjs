import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "vitest";
import { runGtcStateFixture, runFokDifferentials } from "./fok-runtime-fixtures.mjs";

it.each(["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"])("real automatic/final/manual differential executes the current checker for %s", async base => {
  const result = await runFokDifferentials(base);
  assert.equal(result.autoRows.length, 18);
  assert.equal(result.finalRows.length, 4);
  assert.equal(result.manualRows.length, 19);
  assert.deepEqual(result.historicalManualRows.map(row => row.name), ["low balance", "account filter", "muted map", "prematch blocked"]);
}, 30_000); // Historical transpilation exceeded the default 5 seconds on the shared CI runner.

it("real GTC state preserves seeded FOK gates, ignores invalid fills and counts late fills once", () => {
  assert.equal(runGtcStateFixture().gtcCount, 1);
});
it("fixture rejects a newly introduced unmapped state dependency", () => {
  assert.throws(() => runGtcStateFixture((file, options) => {
    const source = readAdapterHistory(file, options);
    return file.endsWith("gtc/executionState.ts") ? `import "./unexpected";\n${source}` : source;
  }), /Unexpected state fixture dependency/);
});
it("fixture detects a GTC fill contaminating real FOK success state", () => {
  assert.throws(() => runGtcStateFixture((file, options) => {
    const source = readAdapterHistory(file, options);
    return file.endsWith("gtc/executionState.ts")
      ? `import { markSuccessfulBet } from "@/stores/betting/successMarkers";\n${source.replace("sessionStorage.setItem(key, \"1\");", "markSuccessfulBet(account, row.plan.betRowId, row.plan.target, 2); sessionStorage.setItem(key, \"1\");")}`
      : source;
  }), /Expected values to be strictly deep-equal/);
});
