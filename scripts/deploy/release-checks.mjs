// [changmen 扩展] Independent CI runners check one pinned candidate; no lane authorizes deployment.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { changePlan, planHash } from "./change-plan.mjs";
import { assertAccepted, assertCandidate, sha256 } from "./release-evidence.mjs";
import { assertSupplemental } from "./acceptance-contract.mjs";
import { assertCommittedSource, executeValidationChecks, validationIdentity, validationCommands } from "../verification/verify-change.mjs";

const groups = {
  controls: ["deployment-control", "validation-control", "verification-control", "verification-node", "boundaries"],
  backend: ["router-compile", "backend", "database-compatibility", "backend-installation"],
  frontend: ["frontend-typecheck", "frontend", "build"],
};
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const runIdentity = env => ({ runId: env.GITHUB_RUN_ID ?? null, attempt: env.GITHUB_RUN_ATTEMPT ?? null });
export function releaseLanes(plan) {
  assert.equal(plan.purpose, "release");
  assert.equal(new Set(plan.checks).size, plan.checks.length, "Duplicate release checks");
  for (const check of plan.checks) assert.equal(Object.values(groups).filter(list => list.includes(check)).length, 1, `Unassigned release check: ${check}`);
  return Object.entries(groups).map(([lane, checks]) => ({ lane, checks: plan.checks.filter(check => checks.includes(check)) }))
    .filter(item => item.checks.length);
}
export function assertReleaseBundle(bundle, root, env = process.env) {
  assertCommittedSource(root);
  assert.equal(bundle.format, 1);
  const currentRun = runIdentity(env);
  assert.equal(bundle.run.runId, currentRun.runId, "Release belongs to another Actions run");
  // Re-running failed jobs keeps the successful planner and its immutable bundle.
  // A new planner invocation still gets a new UUID and invalidates old lane reports.
  if (currentRun.runId !== null) {
    assert.match(bundle.run.attempt ?? "", /^[1-9]\d*$/);
    assert.match(currentRun.attempt ?? "", /^[1-9]\d*$/);
    assert(Number(currentRun.attempt) >= Number(bundle.run.attempt), "Release belongs to a future Actions attempt");
  } else assert.deepEqual(bundle.run, currentRun);
  assert.deepEqual(bundle.identity, validationIdentity(root), "Release candidate changed");
  if (env.GITHUB_SHA) assert.equal(bundle.identity.commit, env.GITHUB_SHA, "Release differs from CI commit");
  assert.equal(planHash(changePlan(bundle.plan.changedPaths, bundle.plan)), bundle.planFingerprint, "Release plan changed");
  assert.equal(planHash(bundle.plan), bundle.planFingerprint, "Release plan fingerprint changed");
  assert.match(bundle.invocationId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(bundle.lanes, releaseLanes(bundle.plan), "Release lane assignment changed");
}
export function prepareRelease(root = process.cwd(), env = process.env) {
  const plan = read(path.join(root, "output/change-validation/plan.json"));
  const bundle = { format: 1, run: runIdentity(env), invocationId: randomUUID(), identity: validationIdentity(root),
    plan, planFingerprint: planHash(plan), lanes: releaseLanes(plan) };
  assertReleaseBundle(bundle, root, env);
  write(path.join(root, "output/change-validation/bundle.json"), bundle);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ lane: bundle.lanes.map(item => item.lane) })}\nnode-version=${process.version}\n`);
  return bundle;
}
export function runReleaseLane(lane, { root = process.cwd(), env = process.env, npm = env.npm_execpath, run = spawnSync } = {}) {
  const bundle = read(path.join(root, "output/change-validation/bundle.json"));
  assertReleaseBundle(bundle, root, env);
  const selected = bundle.lanes.find(item => item.lane === lane);
  assert(selected, "Unexpected release lane"); assert(npm, "Missing npm CLI");
  const directory = path.join(root, "output/release-lanes"), file = path.join(directory, `${lane}.json`);
  fs.mkdirSync(directory, { recursive: true }); fs.rmSync(file, { force: true });
  const report = { lane, identity: bundle.identity, run: bundle.run, releaseInvocationId: bundle.invocationId,
    planFingerprint: bundle.planFingerprint, passed: false, sourceStable: false, npm, artifacts: {}, results: [] };
  try {
    Object.assign(report, executeValidationChecks({ ...bundle.plan, checks: selected.checks }, { cwd: root, npm, run }));
    report.sourceStable = JSON.stringify(validationIdentity(root)) === JSON.stringify(bundle.identity);
    report.passed = report.sourceStable && report.results.length === selected.checks.length && report.results.every(row => row.passed);
    if (report.passed && selected.checks.includes("database-compatibility")) {
      const database = read(path.join(root, "output/database-compatibility/verdict.json"));
      assertSupplemental(database, "database", { identity: bundle.identity });
      write(path.join(directory, "database.json"), database);
      report.artifacts.database = sha256(fs.readFileSync(path.join(directory, "database.json")));
    }
    if (report.passed && selected.checks.includes("backend-installation")) {
      const installation = read(path.join(root, "output/backend-linux-runtime/verdict.json"));
      assertSupplemental(installation, "backend-installation", { identity: bundle.identity });
      write(path.join(directory, "backend-installation.json"), installation);
      report.artifacts.backendInstallation = sha256(fs.readFileSync(path.join(directory, "backend-installation.json")));
    }
    if (report.passed && selected.checks.includes("build")) {
      const archive = path.join(directory, "frontend.tgz");
      execFileSync("tar", ["-czf", archive, "-C", path.join(root, "client/web/dist"), "."], { windowsHide: true });
      report.artifacts.frontend = sha256(fs.readFileSync(archive));
    }
  } catch (error) { report.passed = false; report.error = error.message; }
  write(file, report);
  return report;
}
export function mergeReleaseReports(bundle, reports, root, env = process.env) {
  assertReleaseBundle(bundle, root, env);
  assert.equal(reports.length, bundle.lanes.length, "Missing or duplicated release lanes");
  const rows = new Map(), laneEvidence = [];
  for (const selected of bundle.lanes) {
    const matches = reports.filter(report => report.lane === selected.lane);
    assert.equal(matches.length, 1, "Missing or duplicated release lane: " + selected.lane);
    const report = matches[0];
    assert.equal(report.passed, true, "Release lane failed: " + selected.lane);
    assert.equal(report.sourceStable, true, "Release lane source changed");
    assert.deepEqual(report.identity, bundle.identity, "Release lane candidate mismatch");
    assert.deepEqual(report.run, bundle.run, "Release lane run mismatch");
    assert.equal(report.releaseInvocationId, bundle.invocationId, "Stale release lane invocation");
    assert.equal(report.planFingerprint, bundle.planFingerprint, "Release lane plan mismatch");
    assert.deepEqual(report.executionOrder, selected.checks, "Release lane execution order mismatch");
    assert.deepEqual(report.results.map(row => row.check), selected.checks, "Release lane checks mismatch");
    assert.equal(typeof report.npm, "string"); assert(report.npm.length);
    const commands = validationCommands(bundle.plan, report.npm, bundle.plan.releasePlan);
    for (const row of report.results) {
      const command = commands[row.check];
      assert.deepEqual(row.execution, { command: command.command, cwd: command.cwd ?? "." }, "Release lane command mismatch");
      assert.equal(row.reusedFrom, undefined, "Release lanes must execute their checks");
      rows.set(row.check, row);
    }
    laneEvidence.push({ lane: report.lane, invocationId: report.invocationId, context: report.context, artifacts: report.artifacts });
  }
  const report = { checkedAt: new Date().toISOString(), passed: true, sourceStable: true, tier: bundle.plan.tier,
    paths: bundle.plan.paths, immutableFokEntries: bundle.plan.immutableFokEntries, completeRelease: false,
    results: bundle.plan.checks.map(check => rows.get(check)), executionOrder: bundle.plan.checks,
    invocationId: bundle.invocationId, laneEvidence, identity: bundle.identity, plan: bundle.plan, planFingerprint: bundle.planFingerprint };
  assertAccepted(report); assertCandidate(report, root);
  return report;
}
export function collectRelease(root = process.cwd(), env = process.env) {
  const verdict = path.join(root, "output/change-validation/verdict.json");
  fs.rmSync(verdict, { force: true });
  const bundle = read(path.join(root, "output/change-validation/bundle.json")), directory = path.join(root, "output/release-lanes");
  const reports = bundle.lanes.map(item => read(path.join(directory, `${item.lane}.json`)));
  const report = mergeReleaseReports(bundle, reports, root, env);
  if (bundle.plan.requiredChecks.databaseCompatibility) {
    const databaseFile = path.join(directory, "database.json"), database = read(databaseFile);
    assert.equal(sha256(fs.readFileSync(databaseFile)), reports.find(item => item.lane === "backend").artifacts.database, "Database artifact changed");
    assertSupplemental(database, "database", report);
    write(path.join(root, "output/database-compatibility/verdict.json"), database);
  }
  if (bundle.plan.requiredChecks.backendInstallation) {
    const file = path.join(directory, "backend-installation.json"), installation = read(file);
    assert.equal(sha256(fs.readFileSync(file)), reports.find(item => item.lane === "backend").artifacts.backendInstallation, "Backend installation artifact changed");
    assertSupplemental(installation, "backend-installation", report);
    write(path.join(root, "output/backend-linux-runtime/verdict.json"), installation);
  }
  if (bundle.plan.deployment.components.includes("frontend")) {
    const archive = path.join(directory, "frontend.tgz");
    assert.equal(sha256(fs.readFileSync(archive)), reports.find(item => item.lane === "frontend").artifacts.frontend, "Frontend artifact changed");
    const dist = path.join(root, "client/web/dist");
    assert(!fs.existsSync(dist) || fs.readdirSync(dist).length === 0, "Frontend artifact destination must be empty");
    fs.mkdirSync(dist, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", dist], { windowsHide: true });
  }
  write(verdict, report); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, lane] = process.argv.slice(2);
    if (mode === "prepare") prepareRelease();
    else if (mode === "run") {
      const npm = path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
      const report = runReleaseLane(lane, { npm: process.env.npm_execpath || process.env.CHANGMEN_TEST_NPM_CLI || npm });
      if (!report.passed) { console.error(report.error || `Release lane failed: ${lane}`); process.exitCode = 1; }
    } else if (mode === "collect") collectRelease();
    else throw Error("Expected prepare, run or collect");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
