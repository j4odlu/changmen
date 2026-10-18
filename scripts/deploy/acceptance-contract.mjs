// [changmen 扩展] Supplemental acceptance must describe the exact release inputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Only equivalent invocations may be covered; overlapping/subset suites stay separate.
export const FULL_CHECK_COVERAGE = Object.freeze({
  "verification-control": "protection-negative", "verification-node": "protection-node",
  boundaries: "checks", "router-compile": "router-compile", backend: "backend",
  "frontend-typecheck": "frontend-typecheck", frontend: "frontend", build: "build",
});
export const proofHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function executionContext(env = process.env) {
  return { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch,
    environmentHash: proofHash(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))) };
}
export function comparableExecution(execution) {
  // These exact flags only change Vitest's report destination/format, never selection.
  const vitest = execution.command.indexOf("vitest");
  return { ...execution, command: vitest >= 0 && execution.command[vitest + 1] === "run"
    ? execution.command.filter(arg => arg !== "--reporter=json" && !arg.startsWith("--outputFile=")) : execution.command };
}
export function assertFullReuse(report, acceptance, row) {
  assert.equal(acceptance.plan.requiredChecks.completeRelease, true, "Reuse requires complete acceptance");
  assert.match(acceptance.invocationId ?? "", /^[a-f0-9-]{36}$/, "Missing invocation identity");
  assert.equal(report.invocationId, acceptance.invocationId, "Cannot reuse another invocation");
  const phase = FULL_CHECK_COVERAGE[row.check];
  assert(phase, "Check has no equivalent full audit phase");
  assert.deepEqual(row.reusedFrom, { kind: "full", phase, reportHash: proofHash(report), invocationId: report.invocationId });
  const source = report.results.find(result => result.phase === phase);
  assert.equal(source?.passed, true, "Referenced phase did not pass");
  assert.equal(source.exitCode, 0, "Referenced phase did not execute successfully");
  assert.equal(source.errorCode, null, "Referenced phase failed to start or timed out");
  assert.equal(source.signal, null, "Referenced phase was terminated");
  assert.deepEqual(report.context, acceptance.context, "Execution environment changed");
  assert.deepEqual(comparableExecution(source.execution), comparableExecution(row.execution), "Command or working directory differs");
}

export const FULL_AUDIT_PHASES = ["capture", "release-files", "historical-packages", "fok-core", "vps-core",
  "public-entries", "reviewed-differences", "protection-negative", "protection-node", "gtc-backend-compatibility",
  "checks", "router-compile", "backend", "order-business", "compatibility", "frontend-typecheck",
  "native-copy-migration", "frontend", "build", "node-tests", "runtime-boundaries", "release-stability"];
export const DATABASE_PHASES = ["schema-compatibility", "history-schema", "rds-cli-isolation",
  "rds-assets-standalone", "deploy-account-preservation"];

export function supplementalReports(plan) {
  return [
    ...(plan.requiredChecks.completeRelease ? [{ kind: "full", source: "output/fok-release-verdict.json",
      sealed: "full-acceptance.json", digest: "fullAcceptanceSha256" }] : []),
    ...(plan.requiredChecks.databaseCompatibility ? [{ kind: "database", source: "output/database-compatibility/verdict.json",
      sealed: "database-acceptance.json", digest: "databaseAcceptanceSha256" }] : []),
  ];
}

export function assertSupplemental(report, kind, acceptance) {
  assert.equal(report.passed, true, `${kind}: acceptance failed`);
  assert.equal(report.sourceStable, true, `${kind}: inputs changed`);
  assert.deepEqual(report.identity, acceptance.identity, `${kind}: acceptance belongs to another commit/tree/input fingerprint`);
  if (kind === "full") {
    assert.equal(report.fullReleaseAccepted, true);
    assert.equal(report.evidenceConsistent, true);
    assert.equal(report.releasePlan, acceptance.plan.releasePlan);
    assert.deepEqual(report.immutableBaselines, ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"]);
    assert.match(report.captureId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    for (const role of ["frontend", "backend"]) {
      assert.match(report[`${role}Version`], /^[a-f0-9]{40}$/);
      if (acceptance.plan.deployedVersions)
        assert.equal(report[`${role}Version`], acceptance.plan.deployedVersions[role], `${kind}: deployed baseline changed`);
    }
  } else {
    assert.equal(kind, "database");
    assert.equal(report.localOnly, true);
    assert.equal(report.productionWrites, false);
  }
  const phases = kind === "full" ? FULL_AUDIT_PHASES : DATABASE_PHASES;
  assert.deepEqual(report.results.map(row => ({ phase: row.phase, passed: row.passed })),
    phases.map(phase => ({ phase, passed: true })), `${kind}: missing, duplicated, reordered or failed phases`);
  if (kind === "full") for (const row of acceptance.results ?? [])
    if (row.reusedFrom) assertFullReuse(report, acceptance, row);
}
