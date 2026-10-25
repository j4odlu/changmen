import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { selectVerificationTests } from "./verification-selection.mjs";
import { runVerifierSelfTests } from "./run-self-tests.mjs";
import { validationPlan } from "./validation-plan.mjs";

const scratch = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of scratch.splice(0)) {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("changmen-verifier-selection-")) throw Error("Unexpected cleanup path");
  fs.rmSync(root, { recursive: true, force: true });
} });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-verifier-selection-")); scratch.push(root);
  const write = (file, source) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source); };
  const dailyTests = ["alpha", "beta"].map(name => `scripts/verification/${name}.test.mjs`);
  write(dailyTests[0], 'import "./alpha.mjs";'); write(dailyTests[1], 'import "./beta.mjs";');
  write("scripts/verification/alpha.mjs", 'export * from "./shared.mjs";');
  write("scripts/verification/beta.mjs", 'export const independent = true;');
  write("scripts/verification/shared.mjs", 'const input = "scripts/verification/current-inputs.json";');
  write("scripts/verification/current-inputs.json", "{}");
  return { root, write, dailyTests, select: paths => selectVerificationTests(paths, { root, dailyTests }) };
}
it("only transitive consumers of a changed implementation or current policy are selected", () => {
  const f = fixture();
  for (const file of ["shared.mjs", "current-inputs.json"])
    expect(f.select(["scripts/verification/" + file]).tests).toEqual([f.dailyTests[0]]);
  expect(f.select([f.dailyTests[1]]).tests).toEqual([f.dailyTests[1]]);
});
it("an archived verifier gets its own regression while evidence-only updates do not invoke old proofs", () => {
  const f = fixture(); f.write("scripts/verification/old-boundary.mjs", "export const old = true;");
  f.write("scripts/verification/old-boundary.test.mjs", 'import "./old-boundary.mjs";');
  expect(f.select(["scripts/verification/old-boundary.mjs"])).toMatchObject({ tests: [], historicalTests: ["scripts/verification/old-boundary.test.mjs"] });
  expect(f.select(["scripts/verification/old-boundary.json"])).toMatchObject({ tests: [], historicalTests: [] });
  f.write("scripts/verification/alpha.mjs", 'const incidentalReference="./old-boundary.mjs";');
  expect(f.select(["scripts/verification/old-boundary.mjs"])).toMatchObject({ tests: [f.dailyTests[0]], historicalTests: ["scripts/verification/old-boundary.test.mjs"] });
});
it("renames and deleted dependencies retain their referring tests; the next selection reads fresh source", () => {
  const f = fixture(); fs.unlinkSync(path.join(f.root, "scripts/verification/shared.mjs"));
  expect(f.select(["scripts/verification/shared.mjs"]).tests).toEqual([f.dailyTests[0]]);
  f.write("scripts/verification/beta.mjs", 'import "./new-name.mjs";'); f.write("scripts/verification/new-name.mjs", "");
  expect(f.select(["scripts/verification/shared.mjs", "scripts/verification/new-name.mjs"]).tests).toEqual(f.dailyTests);
});
it("unknown verifiers and boundary entry changes retain all current guards without selecting every archive", () => {
  const f = fixture();
  for (const file of ["scripts/verification/unknown-helper.mjs", "scripts/check-team-boundaries.mjs"])
    expect(f.select([file])).toMatchObject({ tests: f.dailyTests, historicalTests: [] });
  fs.unlinkSync(path.join(f.root, f.dailyTests[0]));
  expect(() => f.select(["scripts/check-team-boundaries.mjs"])).toThrow("Required verifier self-test is missing");
});
it("invalid selection paths fail before launching tests", () => {
  const f = fixture(); for (const file of ["../escape.mjs", "/absolute.mjs", "C:/absolute.mjs"])
    expect(() => f.select([file])).toThrow("Invalid verifier selection path");
});
it("business regressions remain component-scoped and do not invoke verifier or historical audits", () => {
  expect(validationPlan(["server/backend/core/account/order_store.js"]).checks).toEqual(["router-compile", "backend"]);
  expect(validationPlan(["client/web/src/orderModes/gtc/runtime.ts"]).checks).toEqual(["boundaries", "frontend", "build"]);
  expect(validationPlan(["scripts/verification/matcher-lifecycle-increments.json"]).checks).toEqual([]);
  expect(validationPlan(["scripts/verification/pm-loader-binding-inputs.json"]).checks).toEqual(["verification-control"]);
  expect(validationPlan(["scripts/verification/fok-source-specialization.mjs"]).checks).toEqual(["verification-node"]);
});
it("runner fails closed on empty selection, launch errors and failed tests, keeping history opt-in per batch", () => {
  vi.stubEnv("npm_config_call", "node scripts/verification/run-self-tests.mjs --all");
  const f = fixture(), run = vi.fn(() => ({ status: 0 }));
  const select = () => ({ inputs: [], tests: [f.dailyTests[0]], historicalTests: ["scripts/verification/old.test.mjs"] });
  expect(runVerifierSelfTests([], { root: f.root, npm: "npm-cli.js", run, select }).passed).toBe(true);
  expect(run.mock.calls[0][2].env.CHANGMEN_HISTORICAL_AUDIT).toBe("");
  expect(run.mock.calls[0][2].env.npm_config_call).toBeUndefined();
  expect(run.mock.calls[1][2].env.CHANGMEN_HISTORICAL_AUDIT).toBe("1");
  for (const result of [{ status: 1 }, { status: 0, error: Error("failed to start") }]) {
    const fail = vi.fn(() => result);
    expect(runVerifierSelfTests([], { root: f.root, npm: "npm-cli.js", run: fail, select }).passed).toBe(false);
    expect(fail).toHaveBeenCalledOnce();
  }
  expect(() => runVerifierSelfTests([], { root: f.root, npm: "npm-cli.js", run, select: () => ({ tests: [], historicalTests: [] }) })).toThrow("No related");
});
it("the complete historical self-test suite remains available only through an explicit full run", () => {
  const f = fixture(), run = vi.fn(() => ({ status: 0 }));
  expect(runVerifierSelfTests([], { root: f.root, npm: "npm-cli.js", run, all: true }).passed).toBe(true);
  expect(run.mock.calls).toHaveLength(2);
  expect(run.mock.calls[0][1]).toContain("scripts/verification");
  expect(run.mock.calls[1][1]).toContain("--test");
  expect(run.mock.calls.every(call => call[2].env.CHANGMEN_HISTORICAL_AUDIT === "1")).toBe(true);
});
