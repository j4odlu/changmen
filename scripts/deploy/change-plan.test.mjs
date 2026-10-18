import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { changePlan, eventSelection, deployedSelection } from "./change-plan.mjs";

test("unrelated component changes publish independently; shared/API changes coordinate", () => {
  const frontend = "client/web/src/components/admin/Report.vue";
  const backend = "server/backend/core/observability/memory.js";
  assert.equal(changePlan([frontend, backend]).deployment.backendFirst, false);
  for (const paths of [["packages/shared/contract.js"], [frontend, "server/backend/core/esport-api/router.js"],
    [backend, "client/web/src/api/auth.ts"]]) {
    assert.equal(changePlan(paths).deployment.backendFirst, true, paths.join(","));
  }
  assert.equal(changePlan([], { requestedScope: "frontend" }).deployment.backendFirst, false);
  assert.equal(changePlan([], { requestedScope: "full" }).deployment.backendFirst, true);
  assert.equal(changePlan([], { unknownBase: true }).deployment.backendFirst, true);
});
test("RDS maintenance does not select either application", () => {
  for (const maintenance of ["server/backend/db/migrations/044_auth_browser_sessions.sql", "server/db/schema/client_certificates.sql",
    "server/backend/scripts/apply-rds-schema.mjs", "server/backend/scripts/ops/migrations/backfill.mjs",
    "server/backend/scripts/check-rds-schema.mjs", "server/backend/scripts/rds-schema-check.mjs",
    "server/backend/scripts/rds-schema-check.test.mjs", "server/backend/scripts/rds-schema-baseline.json",
    "server/backend/scripts/rds-migrations.mjs", "server/backend/scripts/rds-migrations.test.mjs"]) {
    assert.equal(changePlan([maintenance]).deployment.scope, "noop");
    assert.equal(changePlan([maintenance, "client/web/src/components/admin/Report.vue"]).deployment.scope, "frontend");
    assert.equal(changePlan([maintenance, "server/db/rds/player_store.js"]).deployment.scope, "backend");
  }
});
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
test("manual publication preserves requested components and cannot skip required audit/database checks", () => {
  for (const scope of ["frontend", "backend", "full"]) {
    const plan = changePlan(["docs/note.md"], { requestedScope: scope });
    assert.equal(plan.tier, scope === "full" ? "integration" : scope); assert.equal(plan.deployment.scope, scope);
    assert.equal(plan.purpose, "release"); assert(plan.checks.includes("complete-release"));
    assert(plan.checks.includes("database-compatibility"));
    assert.equal(plan.checks.includes("backend"), scope !== "frontend");
    assert.equal(plan.checks.includes("build"), scope !== "backend");
    assert.equal(plan.releasePlan, scope === "frontend" ? "frontend-only" : "backend-first");
  }
  assert.equal(changePlan([], { unknownBase: true }).deployment.scope, "full");
  assert.throws(() => changePlan([], { requestedScope: "noop" }));
});
test("release intent is separate from risk; no deployment needs no live acceptance", () => {
  const release = changePlan(["client/web/src/components/admin/Report.vue"], { purpose: "release" });
  assert.equal(release.tier, "frontend"); assert(!release.checks.includes("complete-release"));
  assert(!release.checks.includes("deployment-control"));
  const workflowOnly = changePlan([".github/workflows/release.yml"], { purpose: "release" });
  assert.equal(workflowOnly.deployment.scope, "noop"); assert.equal(workflowOnly.tier, "controls");
  assert(!workflowOnly.checks.includes("complete-release"));
  assert(!changePlan(["client/web/src/components/admin/Report.vue"]).checks.includes("deployment-control"));
  assert.throws(() => changePlan([], { purpose: "fast" }));
});

test("required publication checks follow risk without expanding component selection or weakening daily offline checks", () => {
  const cases = [
    [["client/web/src/components/admin/Report.vue"], false, false],
    [["client/web/src/orderModes/gtc/api.ts"], true, false],
    [["server/backend/core/observability/memory.js"], false, true],
    [["server/backend/core/account/order_store.js"], true, true],
    [["packages/shared/contract.js"], true, true],
    [["client/web/src/components/admin/Report.vue", "server/backend/scripts/apply-rds-schema.mjs"], true, true],
    [["scripts/deploy/publish.sh"], true, true],
    [["unknown/file.js"], true, true],
    [["docs/note.md"], false, false],
    [[".github/workflows/release.yml"], false, false],
  ];
  for (const [paths, completeRelease, databaseCompatibility] of cases) {
    const daily = changePlan(paths), release = changePlan(paths, { purpose: "release" });
    assert.deepEqual(release.deployment, daily.deployment);
    assert.deepEqual(release.requiredChecks, { completeRelease, databaseCompatibility }, paths.join(","));
    assert.equal(release.checks.includes("complete-release"), completeRelease);
    assert.equal(release.checks.includes("database-compatibility"), databaseCompatibility);
    assert(!daily.checks.includes("complete-release")); assert(!daily.checks.includes("database-compatibility"));
    assert(release.checks.includes("fok-551"));
  }
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

test("maintenance-only push coverage moves into release validation without selecting an application", () => {
  for (const file of ["server/backend/db/migrations/044_auth_browser_sessions.sql",
    "server/backend/scripts/apply-rds-schema.mjs", "server/backend/scripts/rds-schema-check.mjs",
    "server/backend/scripts/apply-order-observation-schema.mjs", ".github/workflows/database-compatibility.yml"]) {
    const daily = changePlan([file]), release = changePlan([file], { purpose: "release" });
    assert.deepEqual(release.deployment, daily.deployment);
    assert.equal(release.deployment.scope, "noop", file);
    assert.equal(release.requiredChecks.completeRelease, false);
    assert.equal(release.requiredChecks.databaseCompatibility, true, file);
    assert.equal(release.checks.filter(check => check === "database-compatibility").length, 1);
    assert(release.checks.includes("fok-551"));
    assert(!daily.checks.includes("database-compatibility"), "Daily/PR validation stays offline");
  }
});

test("already-deployed inputs and repeated paths do not skip or duplicate database validation", () => {
  const file = "server/backend/db/migrations/044_auth_browser_sessions.sql";
  const plan = changePlan([file, file], { purpose: "release", liveComponents: [],
    deployedVersions: { frontend: "a".repeat(40), backend: "b".repeat(40) }, eventPaths: [file] });
  assert.deepEqual(plan.deployment.components, []);
  assert.equal(plan.requiredChecks.databaseCompatibility, true);
  assert.equal(plan.checks.filter(check => check === "database-compatibility").length, 1);
  assert.equal(changePlan(["docs/notes.md"], { purpose: "release" }).requiredChecks.databaseCompatibility, false);
  assert.equal(changePlan(["client/web/src/style.css"], { purpose: "release" }).requiredChecks.databaseCompatibility, false);
});
