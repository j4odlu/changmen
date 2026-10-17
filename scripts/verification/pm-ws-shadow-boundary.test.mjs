import fs from "node:fs";
import { test, expect } from "vitest";
import { restorePmWsShadowSource, verifyPmWsShadowContract } from "./pm-ws-shadow-boundary.mjs";
import { restorePmExecutionShadowSource } from "./pm-execution-shadow-boundary.mjs";
const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const { changes } = JSON.parse(read("scripts/verification/pm-ws-shadow-increments.json"));
test("shadow hooks restore full pre-implementation modules without changing fixed baselines", () => {
  expect(() => verifyPmWsShadowContract(read)).not.toThrow();
});
test.each(Object.keys(changes))("unregistered change to %s is still rejected", file => {
  expect(() => verifyPmWsShadowContract(target => read(target) + (target === file ? "\nvoid unexpected();" : ""))).toThrow();
  const after = changes[file].increments[0][1];
  const previousLayer = restorePmExecutionShadowSource(file, read(file));
  expect(() => restorePmWsShadowSource(file, previousLayer.replace(after, after + after), true)).toThrow();
});
