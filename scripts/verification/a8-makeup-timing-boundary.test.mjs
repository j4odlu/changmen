import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from "node:fs";
import { readAdapterBrowserSource } from "./adapter-browser-relocation.mjs";
import { expect, it } from "vitest";
import { gitSource, moduleTokens, replaceExact } from "./fok-exact-boundaries.mjs";
import { makeupTimingPreviousCommit, restoreA8MakeupTiming } from "./a8-makeup-timing-boundary.mjs";
const read = withAdapterHistoryReader(file => readAdapterBrowserSource(file, readAdapterHistory(file, "utf8")));
const phases = "client/web/src/stores/betting/autoBet/phases/";

it.each(["placeArbLegs.ts", "finalizeArbBet.ts"])("restores only the exact removed premature-queue behavior before checking the entire prior module: %s", (name) => {
  const file = phases + name;
  const previous = gitSource(makeupTimingPreviousCommit, file);
  expect(moduleTokens(restoreA8MakeupTiming(file, read(file), replaceExact, gitSource))).toEqual(moduleTokens(previous));
  const altered = read(file).replace("betBothLegs", "unexpectedPairCondition");
  expect(moduleTokens(restoreA8MakeupTiming(file, altered, replaceExact, gitSource))).not.toEqual(moduleTokens(previous));
});

it("retains the entire rejection detection, pairing rules and independent RAY decisions unchanged", () => {
  for (const file of [
    phases + "settleBothArbLegs.ts",
    "client/web/src/stores/betting/autoBet/rejectWait.ts",
    "client/web/src/stores/betting/autoBet/arbLegSettle.ts",
    "client/web/src/stores/betting/autoBet/arbMakeUpPair.ts",
    "client/web/src/stores/betting/autoBet/arbMakeUpFromRejects.ts",
    ...["contexts", "autoMakeup", "match", "state"].map(name => `client/web/src/runtime/rayOrderMonitor/${name}.ts`),
    "packages/venue-adapter/adaptation/a8LegOutcome.ts",
  ]) {
    expect(read(file).replaceAll("\r\n", "\n"), file).toBe(gitSource(makeupTimingPreviousCommit, file));
  }
});

it("does not accept arbitrary new enqueue behavior in the corrected submit stage", () => {
  const file = phases + "placeArbLegs.ts";
  const altered = read(file).replace('trace?.event("重试", "换腿未成功");', 'trace?.event("重试", "换腿未成功"); await enqueueUnexpectedOrder();');
  expect(() => restoreA8MakeupTiming(file, altered, replaceExact, gitSource)).toThrow();
});
