import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { assertCommittedSource, assertStagedSource, changedValidationPaths, runChangeValidation } from "./verify-change.mjs";
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-validation-"));
  git(root, "init", "-q"); fs.writeFileSync(path.join(root, "root.txt"), "base"); git(root, "add", ".");
  git(root, "-c", "user.name=Validation Test", "-c", "user.email=validation@example.invalid", "commit", "-qm", "fixture");
  fs.mkdirSync(path.join(root, "docs")); fs.writeFileSync(path.join(root, "docs/notes.md"), "new");
  return root;
}
it("documents require no commands and still produce a scoped report", () => {
  const cwd = fixture(), run = vi.fn(() => ({ status: 1 }));
  const report = runChangeValidation([], { cwd, npm: "npm-cli.js", run });
  expect(report.tier).toBe("docs"); expect(report.passed).toBe(true);
  expect(report.immutableFokEntries).toBe(0);
  expect(report.executionOrder).toEqual([]);
  expect(run).not.toHaveBeenCalled();
});
it("a successful scoped check is not a complete release approval, and input drift is rejected", () => {
  const cwd = fixture(); const clean = runChangeValidation([], { cwd, npm: "npm-cli.js", run: () => ({ status: 0 }) });
  expect(clean.passed).toBe(true); expect(clean.completeRelease).toBe(false);
  fs.mkdirSync(path.join(cwd, "client/web"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "client/web/app.ts"), "changed");
  const run = () => { fs.writeFileSync(path.join(cwd, "added.js"), "unexpected work"); return { status: 0 }; };
  const drift = runChangeValidation([], { cwd, npm: "npm-cli.js", run }); expect(drift.sourceStable).toBe(false); expect(drift.passed).toBe(false);
});
it("staged-only validation rejects unrelated source and actual unstaged changes", () => {
  const cwd = fixture(); git(cwd, "add", "docs/notes.md");
  expect(changedValidationPaths({ staged: true }, cwd)).toEqual(["docs/notes.md"]); expect(() => assertStagedSource(cwd)).not.toThrow();
  fs.writeFileSync(path.join(cwd, "pending.js"), "pending"); expect(() => assertStagedSource(cwd)).toThrow("contaminate");
});
it("plan-only execution never invokes a check or claims it passed", () => {
  const run = vi.fn(), report = runChangeValidation(["--plan"], { cwd: fixture(), run });
  expect(report.planOnly).toBe(true); expect(report.passed).toBe(false); expect(run).not.toHaveBeenCalled();
});
it("publication rejects both staged and untracked source before running checks", () => {
  const cwd = fixture(), run = vi.fn(() => ({ status: 0 }));
  fs.writeFileSync(path.join(cwd, "pending.js"), "pending");
  expect(() => assertCommittedSource(cwd)).toThrow("Uncommitted");
  expect(() => runChangeValidation(["--publish=backend"], { cwd, npm: "npm-cli.js", run })).toThrow("Uncommitted");
  git(cwd, "add", "pending.js");
  expect(() => runChangeValidation(["--publish=frontend"], { cwd, npm: "npm-cli.js", run })).toThrow("Uncommitted");
  expect(run).not.toHaveBeenCalled();
});
it("daily core checks stay offline and cannot claim complete release approval", () => {
  const cwd = fixture(); fs.mkdirSync(path.join(cwd, "rds"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "rds/order.js"), "changed");
  const run = vi.fn(() => ({ status: 0 }));
  const report = runChangeValidation([], { cwd, npm: "npm-cli.js", run });
  expect(report.tier).toBe("backend"); expect(report.passed).toBe(true); expect(report.completeRelease).toBe(false);
  expect(report.plan.purpose).toBe("change");
  expect(report.immutableFokEntries).toBe(0);
  for (const check of ["fok-551", "verification-control", "verification-node"])
    expect(report.executionOrder).not.toContain(check);
  expect(report.executionOrder).toEqual(["router-compile", "backend"]);
  expect(run.mock.calls.every(call => !call[1].some(arg => /check:fok|verify-fok/.test(arg)))).toBe(true);
});
it.each(["frontend", "backend", "full"])("%s publication executes its component checks without a FOK or live audit", scope => {
  const cwd = fixture(), run = vi.fn(() => ({ status: 0 }));
  const report = runChangeValidation(["--publish=" + scope], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(true); expect(report.completeRelease).toBe(false);
  expect(report.immutableFokEntries).toBe(0);
  expect(report.executionOrder).toEqual(report.plan.checks);
  expect(report.results.every(row => !row.reusedFrom)).toBe(true);
  expect(run.mock.calls.some(call => call[1].includes("check:fok-vps") || call[1].some(arg => /verify-(?:fok-)?release\.mjs$/.test(arg)))).toBe(false);
  expect(report.plan.checks.includes("backend")).toBe(scope !== "frontend");
  expect(report.plan.checks.includes("frontend")).toBe(scope !== "backend");
  expect(report.plan.checks.includes("build")).toBe(scope !== "backend");
});

it.each(["backend", "build", "database-compatibility", "backend-installation"])("a failed %s still stops publication before subsequent checks", failure => {
  const cwd = fixture(); let failed = false;
  const run = vi.fn((_node, args) => {
    const hit = failure === "validation-control" ? args.includes("scripts/verification/validation-plan.test.mjs")
      : failure === "backend" ? args.includes("test:backend") : failure === "build" ? args.includes("app:build")
      : failure === "database-compatibility" ? args.includes("scripts/deploy/check-database-compatibility.mjs")
      : args.includes("scripts/testing/backend-linux-runtime.mjs");
    expect(failed).toBe(false); failed = hit; return { status: hit ? 23 : 0 };
  });
  const report = runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(false); expect(report.results.at(-1)).toMatchObject({ check: failure, passed: false, exitCode: 23 });
});

it("a stale successful FOK audit cannot replace or bypass a current component failure", () => {
  const cwd = fixture(); fs.mkdirSync(path.join(cwd, "output"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "output/fok-release-verdict.json"), JSON.stringify({ passed: true }));
  const run = vi.fn((_node, args) => ({ status: args.includes("test:backend") ? 1 : 0 }));
  const report = runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(false); expect(report.results.at(-1).check).toBe("backend");
  expect(report.results.every(row => !row.reusedFrom)).toBe(true);
  expect(run.mock.calls.some(call => call[1].includes("app:build"))).toBe(false);
});

it("source changes during component execution still invalidate publication", () => {
  const cwd = fixture(), run = () => { fs.writeFileSync(path.join(cwd, "drift.js"), "changed"); return { status: 0 }; };
  const report = runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(false); expect(report.sourceStable).toBe(false);
});

it("a check that fails to launch cannot leave an earlier acceptance usable", () => {
  const cwd = fixture();
  expect(runChangeValidation(["--publish=backend"], { cwd, npm: "npm-cli.js", run: () => ({ status: 0 }) }).passed).toBe(true);
  expect(() => runChangeValidation(["--publish=backend"], { cwd, npm: "npm-cli.js", run: () => { throw Error("launch failed"); } })).toThrow("launch failed");
  expect(fs.existsSync(path.join(cwd, "output/change-validation/verdict.json"))).toBe(false);
});

it("a zero-status timeout is still a failure and stops the next check", () => {
  const cwd = fixture(), run = vi.fn(() => ({ status: 0, error: { code: "ETIMEDOUT" } }));
  expect(runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run }).passed).toBe(false);
  expect(run).toHaveBeenCalledOnce();
});

it("planner regressions still fail closed when the planner itself changes", () => {
  const cwd = fixture(); fs.mkdirSync(path.join(cwd, "scripts/verification"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "scripts/verification/validation-plan.mjs"), "changed");
  const run = vi.fn((_node, args) => ({ status: args.includes("scripts/verification/validation-plan.test.mjs") ? 23 : 0 }));
  const report = runChangeValidation([], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(false);
  expect(report.results.at(-1)).toMatchObject({ check: "validation-control", passed: false, exitCode: 23 });
  expect(run).toHaveBeenCalledTimes(2);
});
