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
