import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import { checkPresentation } from "./check-presentation.mjs";
import { presentationTests } from "./presentation-policy.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("runs the fixed display and parent integration suites from the frontend workspace", () => {
  vi.stubEnv("npm_config_call", "node scripts/verification/check-presentation.mjs");
  const run = vi.fn(() => ({ status: 0 }));
  expect(checkPresentation({ root: process.cwd(), npm: "npm-cli.js", run })).toBe(true);
  const [, args, options] = run.mock.calls[0];
  expect(args).toEqual(["npm-cli.js", "exec", "--", "vitest", "run",
    ...presentationTests.map(file => file.slice("client/web/".length)), "--maxWorkers=2"]);
  expect(options.cwd.replaceAll("\\", "/")).toMatch(/\/client\/web$/);
  expect(options.env.npm_config_call).toBeUndefined();
});
it.each([{ status: 1 }, { status: null, signal: "SIGTERM" }, { status: 0, error: Error("launch") }])("does not pass failed test execution %j", result => {
  expect(checkPresentation({ npm: "npm-cli.js", run: () => result })).toBe(false);
});
it("rejects missing/broken components before launching tests", () => {
  const run = vi.fn();
  expect(() => checkPresentation({ root: "missing-fixture-root", npm: "npm-cli.js", run })).toThrow();
  expect(run).not.toHaveBeenCalled();
});
it("cannot silently drop a deleted test when Vitest's other filters still match", () => {
  const exists = fs.existsSync.bind(fs), run = vi.fn();
  vi.spyOn(fs, "existsSync").mockImplementation(file => String(file).replaceAll("\\", "/").endsWith(presentationTests[0]) ? false : exists(file));
  expect(() => checkPresentation({ npm: "npm-cli.js", run })).toThrow("Required presentation test missing");
  expect(run).not.toHaveBeenCalled();
});
