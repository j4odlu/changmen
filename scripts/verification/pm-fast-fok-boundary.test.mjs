import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { test, expect } from "vitest";
import { verifyPmFastFokContract } from "./pm-fast-fok-boundary.mjs";
const readBeforeExecution = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8"));
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
const registry = JSON.parse(read("scripts/verification/pm-fast-fok-increments.json"));
test("fast FOK restores every changed module to its pre-change state", () => {
  expect(() => verifyPmFastFokContract(read)).not.toThrow();
});
test.each([...Object.keys(registry.changes), ...Object.keys(registry.helpers)])("rejects unregistered changes to %s", file => {
  expect(() => verifyPmFastFokContract(target => read(target) + (file === target ? "\nvoid unexpected();" : ""))).toThrow();
});
