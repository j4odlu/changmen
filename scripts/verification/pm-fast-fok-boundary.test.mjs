import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import fs from "node:fs";
import { test, expect } from "vitest";
import { verifyPmFastFokContract } from "./pm-fast-fok-boundary.mjs";
const readBeforeExecution = file => fs.readFileSync(file, "utf8");
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
const registry = JSON.parse(read("scripts/verification/pm-fast-fok-increments.json"));
test("fast FOK restores every changed module to its pre-change state", () => {
  expect(() => verifyPmFastFokContract(read)).not.toThrow();
});
test.each([...Object.keys(registry.changes), ...Object.keys(registry.helpers)])("rejects unregistered changes to %s", file => {
  expect(() => verifyPmFastFokContract(target => read(target) + (file === target ? "\nvoid unexpected();" : ""))).toThrow();
});
