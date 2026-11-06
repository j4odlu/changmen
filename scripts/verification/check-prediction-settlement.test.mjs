import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { checkPredictionSettlement, settlementPlan } from "./check-prediction-settlement.mjs";
import { settlementTests } from "./prediction-settlement-policy.mjs";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("keeps rules/persistence and browser/display tests in their actual workspaces", () => {
  vi.stubEnv("npm_config_call", "node scripts/verification/check-prediction-settlement.mjs");
  const run = vi.fn(() => ({ status: 0 }));
  expect(checkPredictionSettlement({ run })).toBe(true);
  expect(run).toHaveBeenCalledTimes(2);
  const groups = settlementPlan();
  expect(groups.flatMap(group => group.tests)).toEqual(Object.values(settlementTests).flat());
  expect(new Set(groups.flatMap(group => group.tests)).size).toBe(groups.flatMap(group => group.tests).length);
  groups.forEach((group, i) => {
    const [node, args, options] = run.mock.calls[i];
    expect(node).toBe(process.execPath);
    expect(args).toContain(path.join(groups[0].cwd, group.config));
    expect(options.cwd).toBe(group.cwd);
    expect(options.env.npm_config_call).toBeUndefined();
  });
});

it.each([{ status: 1 }, { status: null, signal: "SIGTERM" }, { status: 0, error: Error("launch") }])(
  "stops on failed execution without claiming the second group passed: %j", result => {
    const run = vi.fn(() => result);
    expect(checkPredictionSettlement({ run })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

it("fails when the browser group fails after rules pass", () => {
  const run = vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 });
  expect(checkPredictionSettlement({ run })).toBe(false);
});

it.each([settlementTests.rulesAndPersistence[0], settlementTests.browserAndDisplay[0],
  "scripts/verification/prediction-settlement-browser.config.mjs"])(
  "refuses a missing required input before running any group: %s", missing => {
    const stat = fs.statSync.bind(fs), run = vi.fn();
    vi.spyOn(fs, "statSync").mockImplementation((file, options) =>
      String(file).replaceAll("\\", "/").endsWith(missing) ? undefined : stat(file, options));
    expect(() => checkPredictionSettlement({ run })).toThrow("Required settlement input missing");
    expect(run).not.toHaveBeenCalled();
  });
