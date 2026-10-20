import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { changePlan } from "./change-plan.mjs";
import { prepareRelease, releaseLanes, runReleaseLane, mergeReleaseReports, collectRelease } from "./release-checks.mjs";
import { DATABASE_PHASES } from "./acceptance-contract.mjs";
import { sealEvidence, verifySupplementalEvidence } from "./release-evidence.mjs";
import { readSourceVersion } from "../../devtools/runtime-tooling/runtime_version.js";
import { installationProof } from "./fixtures/backend-installation.mjs";
import { packBackendRepoArchive } from "./pack-git-repo.mjs";
import { sha256 } from "./release-evidence.mjs";

const env = { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" };
const clone = value => structuredClone(value);
const write = (root, file, value) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value)); };
function fixture(t, scope = "full") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-release-lanes-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("changmen-release-lanes-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  write(root, ".gitignore", "output/\nclient/web/dist*/\n");
  write(root, "server/backend/server.js", "export const backend = true;");
  write(root, "client/web/src/App.vue", "<template>app</template>");
  write(root, "scripts/deploy/verify-runtime.mjs", fs.readFileSync(new URL("./verify-runtime.mjs", import.meta.url), "utf8"));
  git("add", "."); git("-c", "user.name=Lane Test", "-c", "user.email=lane@example.invalid", "commit", "-qm", "fixture");
  const plan = scope === "ui" ? changePlan(["client/web/src/components/admin/Report.vue"], { purpose: "release" })
    : scope === "noop" ? changePlan(["docs/note.md"], { purpose: "release" })
    : changePlan([], { purpose: "release", requestedScope: scope, unknownBase: true });
  write(root, "output/change-validation/plan.json", plan);
  const bundle = prepareRelease(root, env), calls = [];
  function run(_node, args) {
    calls.push(args);
    if (args.includes("scripts/testing/backend-linux-runtime.mjs")) {
      const proof = installationProof(bundle.identity), archive = path.join(root, "output/test-backend.tgz");
      proof.archive = { ...packBackendRepoArchive(root, archive), sha256: sha256(fs.readFileSync(archive)),
        sourceFingerprint: readSourceVersion(root, "backend").sourceFingerprint, fingerprintParity: true, browserSourcesAbsent: true };
      write(root, "output/backend-linux-runtime/verdict.json", proof);
    }
    if (args.includes("scripts/deploy/check-database-compatibility.mjs")) write(root, "output/database-compatibility/verdict.json", {
      passed: true, sourceStable: true, localOnly: true, productionWrites: false, identity: bundle.identity,
      results: DATABASE_PHASES.map(phase => ({ phase, passed: true })),
    });
    if (args.includes("app:build")) {
      write(root, "client/web/dist/runtime-version.json", { frontend: readSourceVersion(root, "frontend"), backendUrl: "https://api.changmen.fun/api/runtime-version" });
      write(root, "client/web/dist/index.html", "<html>verified build</html>");
    }
    return { status: 0 };
  }
  const reports = bundle.lanes.map(({ lane }) => runReleaseLane(lane, { root, env, npm: "npm-cli.js", run }));
  return { root, bundle, reports, calls, run };
}
test("independent lanes cover each check once; unknown checks cannot disappear", () => {
  for (const scope of ["frontend", "backend", "full"]) {
    const plan = changePlan([], { purpose: "release", requestedScope: scope });
    assert.deepEqual(releaseLanes(plan).flatMap(item => item.checks).sort(), [...plan.checks].sort());
  }
  assert.throws(() => releaseLanes({ purpose: "release", checks: ["unknown"] }), /Unassigned/);
  assert.throws(() => releaseLanes({ purpose: "release", checks: ["build", "build"] }), /Duplicate/);
});
test("frontend-only and no-op releases do not invent a backend or database requirement", t => {
  for (const scope of ["ui", "noop"]) {
    const f = fixture(t, scope);
    assert(!f.bundle.lanes.some(item => item.lane === "backend"));
    assert.equal(f.bundle.plan.requiredChecks.databaseCompatibility, false);
    if (scope === "ui") fs.renameSync(path.join(f.root, "client/web/dist"), path.join(f.root, "client/web/dist.built"));
    const report = collectRelease(f.root, env);
    assert.equal(report.passed, true);
    assert.deepEqual(sealEvidence(f.root).report.plan.deployment.components, scope === "ui" ? ["frontend"] : []);
  }
});
test("all lane reports merge in planned order and seal the exact built artifact plus DB proof", t => {
  const f = fixture(t);
  assert(f.reports.every(report => report.passed));
  assert.equal(f.calls.filter(args => args.includes("app:build")).length, 1);
  const report = mergeReleaseReports(f.bundle, [...f.reports].reverse(), f.root, env);
  assert.deepEqual(report.results.map(row => row.check), f.bundle.plan.checks);
  fs.renameSync(path.join(f.root, "client/web/dist"), path.join(f.root, "client/web/dist.built"));
  collectRelease(f.root, env);
  assert.equal(fs.readFileSync(path.join(f.root, "client/web/dist/index.html"), "utf8"), "<html>verified build</html>");
  const evidence = sealEvidence(f.root);
  assert(evidence.archives.frontend); assert(evidence.archives.backend);
  assert.equal(evidence.report.laneEvidence.length, 3);
  verifySupplementalEvidence(evidence, path.join(f.root, "output/release-validation"));
});
test("missing, duplicated, stale, failed, altered and partially executed lanes never authorize a release", t => {
  const f = fixture(t);
  for (const mutate of [
    reports => reports.pop(),
    reports => { reports[1] = clone(reports[0]); },
    reports => { reports[0].passed = false; },
    reports => { reports[0].sourceStable = false; },
    reports => { reports[0].identity.commit = "a".repeat(40); },
    reports => { reports[0].run.attempt = "2"; },
    reports => { reports[0].releaseInvocationId = "a".repeat(36); },
    reports => { reports[0].planFingerprint = "b".repeat(64); },
    reports => { reports[0].results.pop(); },
    reports => { reports[0].executionOrder.push("build"); },
    reports => { reports[0].results[0].exitCode = 1; },
    reports => { reports[0].results[0].errorCode = "ETIMEDOUT"; },
    reports => { reports[0].results[0].signal = "SIGTERM"; },
    reports => { reports[0].results[0].execution.command.push("--skip"); },
    reports => { reports[0].results[0].reusedFrom = {}; },
  ]) {
    const reports = clone(f.reports); mutate(reports);
    assert.throws(() => mergeReleaseReports(f.bundle, reports, f.root, env));
  }
  assert.throws(() => mergeReleaseReports(f.bundle, f.reports, f.root, { ...env, GITHUB_RUN_ID: "124" }), /Actions run/);
  assert.equal(mergeReleaseReports(f.bundle, f.reports, f.root, { ...env, GITHUB_RUN_ATTEMPT: "2" }).passed, true);
  const future = clone(f.bundle); future.run.attempt = "3";
  assert.throws(() => mergeReleaseReports(future, f.reports, f.root, env), /future Actions attempt/);
  const changed = clone(f.bundle); changed.plan.checks.pop();
  assert.throws(() => mergeReleaseReports(changed, f.reports, f.root, env), /plan fingerprint/);
  write(f.root, "server/backend/server.js", "changed");
  assert.throws(() => mergeReleaseReports(f.bundle, f.reports, f.root, env), /Uncommitted/);
});
test("failed and throwing commands replace any prior successful lane result", t => {
  const f = fixture(t, "backend");
  for (const run of [() => ({ status: 23 }), () => { throw Error("launch failed"); }]) {
    const result = runReleaseLane("backend", { root: f.root, env, npm: "npm-cli.js", run });
    assert.equal(result.passed, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "output/release-lanes/backend.json"))).passed, false);
    assert.throws(() => collectRelease(f.root, env), /lane failed/);
  }
});
test("changed DB or frontend archives cannot leave an accepted verdict", t => {
  const f = fixture(t);
  fs.renameSync(path.join(f.root, "client/web/dist"), path.join(f.root, "client/web/dist.built"));
  for (const file of ["database.json", "backend-installation.json", "frontend.tgz"]) {
    const target = path.join(f.root, "output/release-lanes", file), original = fs.readFileSync(target);
    const tampered = file.endsWith("json") ? JSON.stringify({ ...JSON.parse(original), localOnly: false }) : "changed archive";
    fs.writeFileSync(target, tampered);
    write(f.root, "output/change-validation/verdict.json", { passed: true });
    assert.throws(() => collectRelease(f.root, env), /artifact changed/);
    assert.equal(fs.existsSync(path.join(f.root, "output/change-validation/verdict.json")), false);
    fs.writeFileSync(target, original);
  }
});
test("CI identity and planned lane assignment cannot be overridden", t => {
  const f = fixture(t, "backend");
  assert.throws(() => runReleaseLane("frontend", { root: f.root, env, npm: "npm-cli.js" }), /Unexpected/);
  const altered = clone(f.bundle); altered.lanes[0].checks = [];
  write(f.root, "output/change-validation/bundle.json", altered);
  assert.throws(() => runReleaseLane("controls", { root: f.root, env, npm: "npm-cli.js" }), /assignment/);
  write(f.root, "output/change-validation/bundle.json", f.bundle);
  assert.throws(() => runReleaseLane("backend", { root: f.root, env: { ...env, GITHUB_SHA: "a".repeat(40) }, npm: "npm-cli.js" }), /CI commit/);
});
