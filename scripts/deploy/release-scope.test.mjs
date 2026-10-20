import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eventSelection, changePlan } from "./change-plan.mjs";

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-publish-scope-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("changmen-publish-scope-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
  const commit = () => { git("add", "."); git("-c", "user.name=Scope Test", "-c", "user.email=scope@example.invalid", "commit", "-qm", "fixture"); return git("rev-parse", "HEAD"); };
  git("init", "-q"); write("README.md", "baseline"); const base = commit();
  const plan = (before, head, versions = { frontend: base, backend: base }) => {
    const selection = eventSelection({ before }, root, head, versions);
    return changePlan(selection.paths, { ...selection, purpose: "release" });
  };
  return { root, git, write, commit, base, plan };
}

for (const [file, components] of [
  ["client/packages/client-core/src/shared/http.ts", ["frontend"]],
  ["client/packages/arb-core/src/index.ts", ["frontend"]],
  ["client/packages/venue-browser/polymarket/fok/bet.ts", ["frontend"]],
  ["client/packages/pm-market-data-browser/src/marketData.worker.ts", ["frontend"]],
  ["server/venues/loader/adapter_paths.mjs", ["backend"]],
  ["packages/api-contract/contract.ts", ["backend", "frontend"]],
  ["packages/shared/catalog/venue_manifest.json", ["backend", "frontend"]],
  ["unknown/new-runtime.js", ["backend", "frontend"]],
  ["scripts/deploy/classify-deploy-scope.mjs", []],
  ["scripts/verification/workspace-layout-history.mjs", []],
]) test(`real push selects ${components.join("+") || "checks only"} for ${file}`, t => {
  const f = repository(t); f.write(file, "changed"); const head = f.commit(), plan = f.plan(f.base, head);
  assert.deepEqual(plan.deployment.components, components);
  assert.equal(plan.checks.includes("backend-installation"), components.includes("backend"));
  for (const [check, component] of [["backend", "backend"], ["frontend", "frontend"], ["build", "frontend"]])
    assert.equal(plan.checks.includes(check), components.includes(component), check);
  if (components.length === 2) assert.equal(plan.deployment.backendFirst, true);
  if (file.startsWith("scripts/verification/")) assert(plan.checks.includes("verification-control"));
});

test("cross-component moves retain deletions and additions; an unknown base stays full", t => {
  const f = repository(t), old = "client/packages/client-core/src/move.ts", next = "server/venues/move.ts";
  f.write(old, "original"); const before = f.commit();
  fs.mkdirSync(path.dirname(path.join(f.root, next)), { recursive: true }); fs.renameSync(path.join(f.root, old), path.join(f.root, next));
  const head = f.commit(), plan = f.plan(before, head, { frontend: before, backend: before });
  assert(plan.paths.includes(old)); assert(plan.paths.includes(next));
  assert.deepEqual(plan.deployment.components, ["backend", "frontend"]);
  const selection = eventSelection({ before: "f".repeat(40) }, f.root, head, { frontend: before, backend: before });
  assert.equal(changePlan(selection.paths, { ...selection, purpose: "release" }).deployment.scope, "full");
});

test("a frontend-only release does not create backend catch-up debt on the next CI-only push", t => {
  const f = repository(t); f.write("client/packages/venue-browser/price.ts", "new"); const frontend = f.commit();
  f.write("scripts/deploy/classify-deploy-scope.test.mjs", "updated checks"); const head = f.commit();
  const plan = f.plan(frontend, head, { frontend, backend: f.base });
  assert.deepEqual(plan.deployment.components, []);
});

test("a CI-only push still catches an unpublished shared change for the lagging frontend", t => {
  const f = repository(t); f.write("packages/shared/catalog/venue_manifest.json", "new contract"); const backend = f.commit();
  f.write("scripts/deploy/classify-deploy-scope.test.mjs", "updated checks"); const head = f.commit();
  const plan = f.plan(backend, head, { backend, frontend: f.base });
  assert.deepEqual(plan.deployment.components, ["frontend"]);
  assert(plan.paths.includes("packages/shared/catalog/venue_manifest.json"));
});
