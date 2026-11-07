import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { changePlan } from "./change-plan.mjs";
import { prepareRelease, releaseLanes, runReleaseLane, mergeReleaseReports, collectRelease } from "./release-checks.mjs";
import { DATABASE_PHASES } from "./acceptance-contract.mjs";
import { sealEvidence, verifySupplementalEvidence, assertAccepted } from "./release-evidence.mjs";
import { readSourceVersion } from "../../devtools/runtime-tooling/runtime_version.js";
import { installationProof } from "./fixtures/backend-installation.mjs";
import { packBackendRepoArchive } from "./pack-git-repo.mjs";
import { sha256 } from "./release-evidence.mjs";
import { routerArtifactFixture } from "./fixtures/router-artifact.mjs";

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
  routerArtifactFixture(root);
  write(root, "server/backend/server.js", "export const backend = true;");
  write(root, "client/web/src/App.vue", "<template>app</template>");
  write(root, "scripts/deploy/verify-runtime.mjs", fs.readFileSync(new URL("./verify-runtime.mjs", import.meta.url), "utf8"));
  git("add", "."); git("-c", "user.name=Lane Test", "-c", "user.email=lane@example.invalid", "commit", "-qm", "fixture");
  const plan = scope === "ui" ? changePlan(["client/web/src/components/admin/Report.vue"], { purpose: "release" })
    : scope === "presentation" ? changePlan(["client/web/src/components/order/presentation/OrderProfitLine.vue"], { purpose: "release" })
    : scope === "noop" ? changePlan(["docs/note.md"], { purpose: "release" })
    : scope === "controls" ? changePlan(["scripts/deploy/workflows.test.mjs"], { purpose: "release" })
    : changePlan([], { purpose: "release", requestedScope: scope, unknownBase: true });
  write(root, "output/change-validation/plan.json", plan);
  const bundle = prepareRelease(root, env), calls = [];
  function run(_node, args) {
    calls.push(args);
    if (args.includes("scripts/testing/backend-linux-runtime.mjs")) {
      const proof = installationProof(bundle.identity), archive = path.join(root, "output/backend-linux-runtime/backend.tgz");
      fs.mkdirSync(path.dirname(archive), { recursive: true });
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
test("independent lanes retain every logical check and exactly three declared frontend shards", () => {
  for (const scope of ["frontend", "backend", "full"]) {
    const plan = changePlan([], { purpose: "release", requestedScope: scope });
    const lanes = releaseLanes(plan);
    assert.deepEqual([...new Set(lanes.flatMap(item => item.checks))].sort(), [...plan.checks].sort());
    assert.deepEqual(lanes.filter(item => item.frontendShard).map(item => item.frontendShard),
      scope === "backend" ? [] : ["1/3", "2/3", "3/3"]);
    for (const check of plan.checks.filter(check => check !== "frontend"))
      assert.equal(lanes.filter(lane => lane.checks.includes(check)).length, 1);
    for (const check of ["build", "database-compatibility", "backend-installation"])
      if (plan.checks.includes(check)) assert.equal(lanes.find(lane => lane.checks.includes(check)).checks.length, 1);
  }
  assert.throws(() => releaseLanes({ purpose: "release", checks: ["unknown"] }), /Unassigned/);
  assert.throws(() => releaseLanes({ purpose: "release", checks: ["build", "build"] }), /Duplicate/);
});
test("presentation release retains a typed build, pinned evidence and failure blocking", t => {
  const f = fixture(t, "presentation");
  assert.deepEqual(f.bundle.plan.checks, ["boundaries", "frontend-presentation", "build"]);
  assert.deepEqual(f.bundle.lanes.find(row => row.lane === "frontend").checks, ["frontend-presentation"]);
  assert.deepEqual(f.bundle.lanes.find(row => row.lane === "frontend-build").checks, ["build"]);
  assert(f.calls.some(args => args.includes("scripts/verification/check-presentation.mjs")));
  fs.renameSync(path.join(f.root, "client/web/dist"), path.join(f.root, "client/web/dist.built"));
  fs.unlinkSync(path.join(f.root, "node_modules"));
  assert.equal(collectRelease(f.root, env).passed, true);
  assert(sealEvidence(f.root).archives.frontend);
  const report = runReleaseLane("frontend", { root: f.root, env, npm: "npm-cli.js",
    run: (_node, args) => ({ status: args.includes("scripts/verification/check-presentation.mjs") ? 1 : 0 }) });
  assert.equal(report.passed, false);
  assert.deepEqual(report.executionOrder, ["frontend-presentation"]);
  assert.throws(() => collectRelease(f.root, env), /lane failed/);
});
test("frontend-only, controls-only and no-op releases do not invent a backend or database requirement", t => {
  for (const scope of ["ui", "controls", "noop"]) {
    const f = fixture(t, scope);
    assert(!f.bundle.lanes.some(item => item.lane === "backend"));
    assert.equal(f.bundle.plan.requiredChecks.databaseCompatibility, false);
    if (scope === "ui") fs.renameSync(path.join(f.root, "client/web/dist"), path.join(f.root, "client/web/dist.built"));
    const report = collectRelease(f.root, env);
    assert.equal(report.passed, true);
    assert.deepEqual(sealEvidence(f.root).report.plan.deployment.components, scope === "ui" ? ["frontend"] : []);
  }
});

test("empty plans explicitly skip the matrix and replanning invalidates old lane results", t => {
  const empty = fixture(t, "noop"), output = path.join(empty.root, "output/github-output");
  const bundle = prepareRelease(empty.root, { ...env, GITHUB_OUTPUT: output });
  assert.deepEqual(bundle.lanes, []);
  assert.match(fs.readFileSync(output, "utf8"), /matrix=\{"lane":\[\]\}\nhas-checks=false\n/);
  const active = fixture(t, "ui"), next = prepareRelease(active.root, env);
  assert.notEqual(next.invocationId, active.bundle.invocationId);
  assert.throws(() => mergeReleaseReports(next, active.reports, active.root, env), /Stale release lane invocation/);
});
test("all lane reports merge in planned order and seal the exact built artifact plus DB proof", t => {
  const f = fixture(t);
  assert(f.reports.every(report => report.passed));
  assert.equal(f.calls.filter(args => args.includes("app:build")).length, 1);
  const report = mergeReleaseReports(f.bundle, [...f.reports].reverse(), f.root, env);
  assert.deepEqual(report.results.map(row => row.check), f.bundle.plan.checks);
  fs.renameSync(path.join(f.root, "client/web/dist"), path.join(f.root, "client/web/dist.built"));
  // The collector/sealer runs on a clean runner without npm install.
  fs.unlinkSync(path.join(f.root, "node_modules"));
  collectRelease(f.root, env);
  assert.equal(fs.readFileSync(path.join(f.root, "client/web/dist/index.html"), "utf8"), "<html>verified build</html>");
  const evidence = sealEvidence(f.root);
  assert(evidence.archives.frontend); assert(evidence.archives.backend);
  assert.equal(evidence.archives.backend, f.reports.find(row => row.lane === "backend-runtime").artifacts.backend);
  assert.equal(evidence.report.laneEvidence.length, f.bundle.lanes.length);
  verifySupplementalEvidence(evidence, path.join(f.root, "output/release-validation"));
});

test("frontend acceptance retains every physical command and rejects incomplete or failed shards", t => {
  const f = fixture(t, "ui");
  const accepted = mergeReleaseReports(f.bundle, f.reports, f.root, env);
  const aggregate = accepted.results.find(row => row.check === "frontend");
  assert.equal(aggregate.execution.strategy, "parallel-shards");
  assert.deepEqual(aggregate.execution.parts.map(part => part.shard), ["1/3", "2/3", "3/3"]);
  for (const part of aggregate.execution.parts) assert(part.execution.command.includes(`--shard=${part.shard}`));
  const partIndex = f.reports.findIndex(report => report.frontendShard === "2/3");
  for (const mutate of [
    reports => { reports.splice(partIndex, 1); },
    reports => { reports[partIndex] = clone(reports.find(row => row.frontendShard === "1/3")); },
    reports => { reports[partIndex].frontendShard = "1/3"; },
    reports => { reports[partIndex].results[0].passed = false; },
    reports => { reports[partIndex].results[0].exitCode = 1; },
    reports => { reports[partIndex].results[0].errorCode = "ETIMEDOUT"; },
    reports => { reports[partIndex].results[0].signal = "SIGTERM"; },
    reports => { reports[partIndex].results[0].elapsedMs = Number.NaN; },
    reports => { reports[partIndex].results[0].execution.command.pop(); },
    reports => { reports[partIndex].results[0].execution.command.push("--shard=3/3"); },
  ]) {
    const reports = clone(f.reports); mutate(reports);
    assert.throws(() => mergeReleaseReports(f.bundle, reports, f.root, env));
  }
  const changed = clone(f.bundle);
  changed.lanes = changed.lanes.filter(lane => lane.frontendShard !== "3/3");
  assert.throws(() => mergeReleaseReports(changed, f.reports, f.root, env), /assignment/);
  const transported = clone(accepted);
  for (const part of transported.results.find(row => row.check === "frontend").execution.parts) {
    const lane = transported.laneEvidence.find(lane => lane.lane === part.lane);
    lane.context.executable = "/opt/hostedtoolcache/node/26.13.0/x64/bin/node";
    part.execution.command[0] = lane.context.executable;
  }
  assert.doesNotThrow(() => assertAccepted(transported));
  for (const mutate of [
    row => { row.execution.parts.pop(); },
    row => { row.execution.parts[1] = clone(row.execution.parts[0]); },
    row => { row.execution.parts[0].exitCode = 1; },
    row => { row.execution.parts[0].execution.command.pop(); },
    row => { row.execution.parts[0].execution.command[0] = "/unrecorded/node"; },
    row => { row.execution.parts[0].invocationId = "forged"; },
    row => { row.execution = {}; },
  ]) {
    const altered = clone(accepted); mutate(altered.results.find(row => row.check === "frontend"));
    assert.throws(() => assertAccepted(altered));
  }
});

test("failures in independently scheduled build, database and runtime checks all block collection", t => {
  for (const lane of ["frontend-build", "database-checks", "backend-runtime", "frontend-3"]) {
    const f = fixture(t);
    const failed = runReleaseLane(lane, { root: f.root, env, npm: "npm-cli.js", run: () => ({ status: 1 }) });
    assert.equal(failed.passed, false);
    assert.throws(() => collectRelease(f.root, env), /lane failed/);
    assert.equal(fs.existsSync(path.join(f.root, "output/change-validation/verdict.json")), false);
  }
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
    reports => { reports[0].context.node = "v24.0.0-other"; },
    reports => { reports[0].context.platform = "other"; },
    reports => { reports[0].context.arch = "other"; },
    reports => { delete reports[0].invocationId; },
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
  for (const file of ["database.json", "backend-installation.json", "backend.tgz", "frontend.tgz"]) {
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
  assert.equal(fs.readFileSync(path.join(f.root, "output/change-validation/node-version"), "utf8"), `${process.version}\n`);
  const otherRuntime = { ...f.bundle, nodeVersion: "v24.0.0-different-runner" };
  assert.throws(() => mergeReleaseReports(otherRuntime, f.reports, f.root, env), /Node runtime differs/);
  assert.throws(() => runReleaseLane("frontend-1", { root: f.root, env, npm: "npm-cli.js" }), /Unexpected/);
  const altered = clone(f.bundle); altered.lanes[0].checks = [];
  write(f.root, "output/change-validation/bundle.json", altered);
  assert.throws(() => runReleaseLane("controls", { root: f.root, env, npm: "npm-cli.js" }), /assignment/);
  write(f.root, "output/change-validation/bundle.json", f.bundle);
  assert.throws(() => runReleaseLane("backend", { root: f.root, env: { ...env, GITHUB_SHA: "a".repeat(40) }, npm: "npm-cli.js" }), /CI commit/);
});
