import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_AUDIT_PHASES, DATABASE_PHASES, assertSupplemental, proofHash } from "./acceptance-contract.mjs";
import { installationProof } from "./fixtures/backend-installation.mjs";

test("backend installation requires Linux lifecycle, native execution, all eight entries, isolation and cleanup for this candidate", () => {
  const acceptance = { identity: { commit: "a".repeat(40), candidateTree: "b".repeat(40), inputFingerprint: "c".repeat(64) } };
  const report = installationProof(acceptance.identity);
  assertSupplemental(report, "backend-installation", acceptance);
  for (const mutate of [p => { p.identity.commit = "b".repeat(40); }, p => { p.platform = "win32"; },
    p => { p.lifecycleScriptsEnabled = false; }, p => { p.developmentToolsAbsent = false; },
    p => { p.nativeEsbuildExecuted = false; },
    p => { p.precompiledRouterVerified = false; }, p => { p.routerBuildParity = false; }, p => { p.browserPackagesAbsent = false; },
    p => { p.runtime.processes.pop(); }, p => { p.runtime.processes[1] = p.runtime.processes[0]; },
    p => { p.runtime.processes[0].ready = false; }, p => { p.runtime.processes[0].shutdown.code = 1; },
    p => { p.runtime.externalInterfaceCount = 1; }, p => { p.runtime.allChildrenExited = false; },
    p => { p.dynamicPaths.uncertified = 1; }, p => { p.databaseStopped = false; }, p => { p.steps[0].errorCode = "ETIMEDOUT"; },
    p => { p.runtime.failures.pop(); }, p => { p.runtime.failures[0].rejected = false; },
    p => { delete p.archive; }, p => { p.archive.profile = "full-repository"; }, p => { p.archive.sha256 = "unknown"; },
    p => { p.archive.fingerprintParity = false; }, p => { p.archive.browserSourcesAbsent = false; }]) {
    const broken = structuredClone(report); mutate(broken);
    assert.throws(() => assertSupplemental(broken, "backend-installation", acceptance));
  }
});

function fixture(kind) {
  const identity = { commit: "a".repeat(40), candidateTree: "b".repeat(40), inputFingerprint: "c".repeat(64) };
  const acceptance = { identity, plan: { releasePlan: "backend-first", deployedVersions: { frontend: "d".repeat(40), backend: "e".repeat(40) } } };
  const report = { passed: true, sourceStable: true, identity: structuredClone(identity),
    results: (kind === "full" ? FULL_AUDIT_PHASES : DATABASE_PHASES).map(phase => ({ phase, passed: true })) };
  return { acceptance, report: Object.assign(report, kind === "full" ? { fullReleaseAccepted: true, evidenceConsistent: true,
    releasePlan: "backend-first", immutableBaselines: ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"],
    captureId: "12345678-1234-1234-1234-123456789abc", frontendVersion: "d".repeat(40), backendVersion: "e".repeat(40) }
    : { localOnly: true, productionWrites: false }) };
}
for (const kind of ["full", "database"]) {
  test(`${kind} accepts all original phases only for identical commit, tree and source inputs`, () => {
    const { acceptance, report } = fixture(kind); assertSupplemental(report, kind, acceptance);
    for (const mutate of [p => { p.passed = false; }, p => { p.sourceStable = false; },
      ...["commit", "candidateTree", "inputFingerprint"].map(key => p => { p.identity[key] = "f".repeat(key === "inputFingerprint" ? 64 : 40); }),
      p => { p.results.pop(); }, p => { p.results.push(p.results[0]); }, p => { p.results[1] = p.results[0]; },
      p => { p.results.reverse(); }, p => { p.results[0].passed = false; }, p => { delete p.identity; }]) {
      const changed = structuredClone(report); mutate(changed); assert.throws(() => assertSupplemental(changed, kind, acceptance));
    }
  });
}
test("complete audit rejects another deployed baseline, publication plan, missing consistency and weakened immutable reference", () => {
  const { acceptance, report } = fixture("full");
  for (const mutate of [p => { p.frontendVersion = "f".repeat(40); }, p => { p.backendVersion = "f".repeat(40); },
    p => { p.releasePlan = "frontend-only"; }, p => { p.evidenceConsistent = false; },
    p => { p.fullReleaseAccepted = false; }, p => { p.immutableBaselines.pop(); }, p => { delete p.captureId; }]) {
    const changed = structuredClone(report); mutate(changed); assert.throws(() => assertSupplemental(changed, "full", acceptance));
  }
});
test("database evidence cannot describe production writes or a nonlocal execution", () => {
  const { acceptance, report } = fixture("database");
  assert.throws(() => assertSupplemental({ ...report, localOnly: false }, "database", acceptance));
  assert.throws(() => assertSupplemental({ ...report, productionWrites: true }, "database", acceptance));
});

test("sealed phase references bind invocation, environment, command, directory and full report bytes", () => {
  const { acceptance, report } = fixture("full");
  acceptance.plan.requiredChecks = { completeRelease: true };
  acceptance.invocationId = report.invocationId = "12345678-1234-1234-1234-123456789abc";
  acceptance.context = report.context = { environmentHash: "d".repeat(64) };
  const source = report.results.find(row => row.phase === "frontend");
  Object.assign(source, { exitCode: 0, errorCode: null, signal: null,
    execution: { command: ["node", "npm", "exec", "--", "vitest", "run", "--reporter=json", "--outputFile=report.json"], cwd: "client/web" } });
  const row = { check: "frontend", passed: true, execution: { command: ["node", "npm", "exec", "--", "vitest", "run"], cwd: "client/web" },
    reusedFrom: { kind: "full", phase: "frontend", reportHash: proofHash(report), invocationId: report.invocationId } };
  acceptance.results = [row];
  assertSupplemental(report, "full", acceptance);
  for (const mutate of [r => { r.reusedFrom.reportHash = "f".repeat(64); }, r => { r.reusedFrom.phase = "backend"; },
    r => { r.reusedFrom.invocationId = "stale"; }, r => { r.check = "fok-551"; },
    r => { r.execution.command.push("--exclude=orders"); }, r => { r.execution.cwd = "."; }]) {
    const changed = structuredClone(acceptance); mutate(changed.results[0]);
    assert.throws(() => assertSupplemental(report, "full", changed));
  }
  for (const mutate of [p => { p.invocationId = "stale"; }, p => { p.context.environmentHash = "stale"; },
    p => { p.results.find(r => r.phase === "frontend").exitCode = 1; }]) {
    const changed = structuredClone(report); mutate(changed);
    assert.throws(() => assertSupplemental(changed, "full", acceptance));
  }
});
