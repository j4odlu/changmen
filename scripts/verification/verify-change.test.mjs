import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it, vi } from "vitest";
import { assertCommittedSource, assertStagedSource, changedValidationPaths, runChangeValidation } from "./verify-change.mjs";
import { fullAcceptanceFixture } from "../testing/full-acceptance-fixture.mjs";
import { FULL_CHECK_COVERAGE } from "../deploy/acceptance-contract.mjs";
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-validation-"));
  git(root, "init", "-q"); fs.writeFileSync(path.join(root, "root.txt"), "base"); git(root, "add", ".");
  git(root, "-c", "user.name=Validation Test", "-c", "user.email=validation@example.invalid", "commit", "-qm", "fixture");
  fs.mkdirSync(path.join(root, "docs")); fs.writeFileSync(path.join(root, "docs/notes.md"), "new");
  return root;
}
it("even documents run the real immutable gate first; its failure stops acceptance", () => {
  const cwd = fixture(), run = vi.fn(() => ({ status: 1 }));
  const report = runChangeValidation([], { cwd, npm: "npm-cli.js", run });
  expect(report.tier).toBe("docs"); expect(report.passed).toBe(false);
  expect(run.mock.calls[0][1]).toEqual(["npm-cli.js", "run", "check:fok-vps"]); expect(run).toHaveBeenCalledOnce();
});
it("a successful scoped check is not a complete release approval, and input drift is rejected", () => {
  const cwd = fixture(); const clean = runChangeValidation([], { cwd, npm: "npm-cli.js", run: () => ({ status: 0 }) });
  expect(clean.passed).toBe(true); expect(clean.completeRelease).toBe(false);
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
  const cwd = fixture(); fs.mkdirSync(path.join(cwd, "server/db"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "server/db/order.js"), "changed");
  const run = vi.fn(() => ({ status: 0 }));
  const report = runChangeValidation([], { cwd, npm: "npm-cli.js", run });
  expect(report.tier).toBe("full"); expect(report.passed).toBe(true); expect(report.completeRelease).toBe(false);
  expect(report.plan.purpose).toBe("change");
  expect(run.mock.calls.every(call => !call[1].includes("check:fok-release") && !call[1].includes("scripts/verification/verify-fok-release.mjs"))).toBe(true);
});
it("a full publication gate failure stops before duplicate component work or database checks", () => {
  const cwd = fixture(); const run = vi.fn((_command, args) => ({ status: args.includes("scripts/verification/verify-fok-release.mjs") ? 1 : 0 }));
  const report = runChangeValidation(["--publish=backend"], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(false); expect(report.completeRelease).toBe(false);
  expect(report.plan.purpose).toBe("release");
  expect(run.mock.calls.filter(call => call[1].includes("scripts/verification/verify-fok-release.mjs"))).toHaveLength(1);
  expect(run.mock.calls.some(call => call[1].includes("test:backend") || call[1].includes("scripts/deploy/check-database-compatibility.mjs"))).toBe(false);
});

it("high-risk publication executes full audit once and explicitly references every equivalent phase", () => {
  const cwd = fixture(), run = vi.fn(fullAcceptanceFixture(cwd));
  const report = runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(true);
  expect(report.results.map(row => row.check)).toEqual(report.plan.checks);
  expect(report.results.filter(row => row.reusedFrom).map(row => row.check)).toEqual(report.plan.checks.filter(check => FULL_CHECK_COVERAGE[check]));
  expect(report.executionOrder).toContain("fok-551");
  expect(report.executionOrder.indexOf("fok-551")).toBeLessThan(report.executionOrder.indexOf("complete-release"));
  expect(report.executionOrder).not.toContain("build"); expect(report.executionOrder).not.toContain("backend");
  expect(run.mock.calls.filter(call => call[1].includes("scripts/verification/verify-fok-release.mjs"))).toHaveLength(1);
});

it.each([
  p => { p.invocationId = "stale"; }, p => { p.identity.inputFingerprint = "f".repeat(64); },
  p => { p.context.environmentHash = "f".repeat(64); }, p => { p.results.pop(); },
  p => { p.results.find(r => r.phase === "backend").execution.command.push("--passWithNoTests"); },
  p => { p.results.find(r => r.phase === "backend").execution.cwd = "other"; },
  p => { p.results.find(r => r.phase === "backend").errorCode = "ETIMEDOUT"; },
  p => { p.results.find(r => r.phase === "backend").exitCode = 1; },
  p => { p.results.find(r => r.phase === "backend").signal = "SIGTERM"; },
])("rejects missing execution or stale/changed evidence without falling back to a second acceptance %o", mutate => {
  const cwd = fixture(), run = vi.fn(fullAcceptanceFixture(cwd, mutate));
  const report = runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(false);
  expect(report.results.some(row => row.errorCode === "ACCEPTANCE_EVIDENCE_INVALID")).toBe(true);
  expect(run.mock.calls.some(call => call[1].includes("app:build"))).toBe(false);
});

it("a successful exit with no fresh full report cannot reuse the previous run", () => {
  const cwd = fixture();
  const first = runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run: fullAcceptanceFixture(cwd) });
  expect(first.passed).toBe(true);
  const run = vi.fn(() => ({ status: 0 }));
  const second = runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run });
  expect(second.passed).toBe(false);
  expect(second.results.find(row => row.check === "complete-release").errorCode).toBe("ACCEPTANCE_EVIDENCE_INVALID");
  expect(run.mock.calls.some(call => call[1].includes("app:build"))).toBe(false);
});

it("source changes after full execution block all result reuse", () => {
  const cwd = fixture(), fake = fullAcceptanceFixture(cwd);
  const run = (node, args, options) => {
    const result = fake(node, args, options);
    if (args.includes("scripts/verification/verify-fok-release.mjs")) fs.writeFileSync(path.join(cwd, "drift.js"), "changed");
    return result;
  };
  const report = runChangeValidation(["--publish=full"], { cwd, npm: "npm-cli.js", run });
  expect(report.passed).toBe(false); expect(report.sourceStable).toBe(false);
  expect(report.results.some(row => row.diagnostic?.includes("Inputs changed before reuse"))).toBe(true);
});

it("a zero-status timeout is still a failure and stops the next check", () => {
  const cwd = fixture(), run = vi.fn(() => ({ status: 0, error: { code: "ETIMEDOUT" } }));
  expect(runChangeValidation([], { cwd, npm: "npm-cli.js", run }).passed).toBe(false);
  expect(run).toHaveBeenCalledOnce();
});
