import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { expect, test } from "vitest";
import { restorePmOptimizedFokSource, verifyPmOptimizedFokContract } from "./pm-optimized-fok-boundary.mjs";
const read = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8"));
const registry = JSON.parse(read("scripts/verification/pm-optimized-fok-increments.json"));
test("optimized changes restore the original modules without moving the original baselines", () => {
  expect(() => verifyPmOptimizedFokContract(read)).not.toThrow();
});
test.each(Object.keys(registry.changes))("rejects deletion, additional changes and mode crossover in %s", file => {
  expect(() => verifyPmOptimizedFokContract(target => target === file
    ? restorePmOptimizedFokSource(file, read(file), true) : read(target))).toThrow();
  expect(() => verifyPmOptimizedFokContract(target => read(target) + (target === file ? "\nvoid unexpectedSubmit();" : ""))).toThrow();
});
test.each(Object.keys(registry.helpers))("protects the entire new helper %s", file => {
  expect(() => verifyPmOptimizedFokContract(target => read(target) + (target === file ? "\nvoid unexpectedSubmit();" : ""))).toThrow();
});
