import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { changePlan, eventSelection, deployedSelection } from "./change-plan.mjs";
test("one plan preserves risk while accounting for cross-component dependencies", () => {
  for (const [paths, tier, scope] of [
    [["docs/note.md"], "docs", "noop"],
    [["client/web/src/components/admin/Report.vue"], "frontend", "frontend"],
    [["server/backend/core/observability/memory.js"], "backend", "backend"],
    [["server/storage/runtime_version.js"], "integration", "full"],
    [["scripts/deploy/publish.sh"], "controls", "full"],
    [["client/web/src/orderModes/gtc/api.ts"], "full", "frontend"],
    [["mystery/file.js"], "full", "full"],
  ]) {
    const plan = changePlan(paths);
    assert.equal(plan.tier, tier); assert.equal(plan.deployment.scope, scope); assert.equal(plan.immutableFokEntries, 551);
    assert.equal(plan.releasePlan, scope === "frontend" ? "frontend-only" : "backend-first");
    assert(plan.checks.includes("fok-551")); assert(!plan.checks.includes("complete-release"));
  }
});
test("unpublished changes survive failed/partial earlier pushes and documentation-only followups", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-live-plan-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init", "-q"); fs.mkdirSync(path.join(root, "packages/shared"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages/shared/contract.js"), "old"); git("add", ".");
    const commit = () => git("-c", "user.name=Plan", "-c", "user.email=plan@example.invalid", "commit", "-qm", "fixture");
    commit(); const base = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(root, "packages/shared/contract.js"), "new"); git("add", "."); commit(); const before = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(root, "README.md"), "followup"); git("add", "."); commit(); const head = git("rev-parse", "HEAD");
    const pending = eventSelection({ before }, root, head, { backend: base, frontend: base });
    assert.equal(changePlan(pending.paths, pending).tier, "full");
    assert.deepEqual(changePlan(pending.paths, pending).deployment.components, ["backend", "frontend"]);
    const partial = deployedSelection({ backend: head, frontend: base }, root, head, ["README.md"]);
    assert.deepEqual(changePlan(partial.paths, partial).deployment.components, ["frontend"]);
    assert.equal(changePlan(partial.paths, partial).releasePlan, "frontend-only");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("manual and unknown-base publication retain complete acceptance", () => {
  for (const scope of ["frontend", "backend", "full"]) {
    const plan = changePlan(["docs/note.md"], { requestedScope: scope });
    assert.equal(plan.tier, "full"); assert.equal(plan.deployment.scope, scope);
    assert.equal(plan.purpose, "release"); assert(plan.checks.includes("complete-release"));
    assert.equal(plan.releasePlan, scope === "frontend" ? "frontend-only" : "backend-first");
  }
  assert.equal(changePlan([], { unknownBase: true }).deployment.scope, "full");
  assert.throws(() => changePlan([], { requestedScope: "noop" }));
});
test("release intent is separate from risk; no deployment needs no live acceptance", () => {
  const release = changePlan(["client/web/src/components/admin/Report.vue"], { purpose: "release" });
  assert.equal(release.tier, "full"); assert(release.checks.includes("complete-release"));
  const workflowOnly = changePlan([".github/workflows/release.yml"], { purpose: "release" });
  assert.equal(workflowOnly.deployment.scope, "noop"); assert.equal(workflowOnly.tier, "controls");
  assert(!workflowOnly.checks.includes("complete-release"));
  assert(!changePlan(["client/web/src/components/admin/Report.vue"]).checks.includes("deployment-control"));
  assert.throws(() => changePlan([], { purpose: "fast" }));
});
test("real CI diffs include both sides of renames/deletions, wrong commits fail, unknown base escalates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-event-plan-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init", "-q"); fs.writeFileSync(path.join(root, "old.js"), "old"); git("add", ".");
    const commit = () => git("-c", "user.name=Plan", "-c", "user.email=plan@example.invalid", "commit", "-qm", "fixture");
    commit(); const before = git("rev-parse", "HEAD");
    fs.renameSync(path.join(root, "old.js"), path.join(root, "new.js")); git("add", "."); commit();
    const head = git("rev-parse", "HEAD");
    assert.deepEqual(eventSelection({ before }, root, head).paths.sort(), ["new.js", "old.js"]);
    assert.throws(() => eventSelection({ before }, root, before), /checkout/);
    assert.equal(eventSelection({ before: "b".repeat(40) }, root, head).unknownBase, true);
    assert.equal(eventSelection({ inputs: { component: "frontend" } }, root, head).requestedScope, "frontend");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
