/** [changmen 扩展] Bind actual acceptance and exact archives to the committed candidate. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { changePlan, deployedSelection, planHash } from "./change-plan.mjs";
import { assertCommittedSource, validationInputs } from "../verification/verify-change.mjs";
import { packGitRepoArchive } from "./pack-git-repo.mjs";
// Transport jobs use a source checkout without npm install; this module uses Node builtins only.
import { readSourceVersion } from "../../devtools/runtime-tooling/runtime_version.js";
import { supplementalReports, assertSupplemental } from "./acceptance-contract.mjs";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
export function assertAccepted(report) {
  assert.equal(report.passed, true, "Acceptance did not pass");
  assert.equal(report.sourceStable, true, "Acceptance source changed");
  assert.equal(planHash(report.plan), report.planFingerprint, "Recorded acceptance plan changed");
  const plan = changePlan(report.plan.changedPaths, report.plan);
  assert.equal(report.immutableFokEntries, plan.immutableFokEntries, "Acceptance coverage differs from its plan");
  assert.equal(plan.purpose, "release", "Daily validation is not publication approval");
  assert.equal(report.plan.releasePlan, plan.releasePlan, "Release plan conflicts with component dependencies");
  assert.equal(planHash(plan), report.planFingerprint, "Acceptance plan mismatch");
  assert.equal(report.tier, plan.tier);
  assert.equal(report.completeRelease, plan.checks.includes("complete-release"));
  assert.deepEqual(report.results.map(row => ({ check: row.check, passed: row.passed })),
    plan.checks.map(check => ({ check, passed: true })), "Incomplete acceptance");
  for (const row of report.results) {
    assert.equal(row.exitCode, 0, "Acceptance check did not execute successfully");
    assert.equal(row.errorCode, null, "Acceptance check failed to start or timed out");
    assert.equal(row.signal, null, "Acceptance check was terminated");
  }
  for (const row of report.results) if (row.reusedFrom)
    assert.equal(plan.requiredChecks.completeRelease, true, "Unapproved reuse without complete audit");
  assert.match(report.identity.candidateTree, /^[a-f0-9]{40}$/);
  assert.match(report.identity.inputFingerprint, /^[a-f0-9]{64}$/);
  return plan;
}
export function assertCandidate(report, root) {
  assertCommittedSource(root);
  const plan = assertAccepted(report), commit = git(root, "rev-parse", "HEAD");
  assert.equal(git(root, "rev-parse", "HEAD^{tree}"), report.identity.candidateTree, "Commit differs from verified candidate");
  assert.equal(sha256(JSON.stringify(validationInputs(root))), report.identity.inputFingerprint, "Current inputs differ from acceptance");
  if (report.identity.commit !== null) assert.equal(report.identity.commit, commit, "Acceptance belongs to another commit");
  if (plan.deployedVersions) {
    const selection = deployedSelection(plan.deployedVersions, root, commit, plan.eventPaths);
    const actual = changePlan(selection.paths, { ...selection, purpose: plan.purpose });
    assert.equal(planHash(actual), report.planFingerprint, "Actual deployed diff differs from acceptance");
  }
  return { plan, commit };
}
export function sealEvidence(root = process.cwd()) {
  const directory = path.join(root, "output/release-validation");
  fs.mkdirSync(directory, { recursive: true });
  fs.rmSync(path.join(directory, "evidence.json"), { force: true });
  const report = JSON.parse(fs.readFileSync(path.join(root, "output/change-validation/verdict.json"), "utf8"));
  const { plan, commit } = assertCandidate(report, root);
  const verifier = fs.readFileSync(path.join(root, "scripts/deploy/verify-runtime.mjs"));
  fs.writeFileSync(path.join(directory, "verify-runtime.mjs"), verifier);
  const supplemental = { fullAcceptanceSha256: null, databaseAcceptanceSha256: null };
  for (const required of supplementalReports(plan)) {
    const bytes = fs.readFileSync(path.join(root, required.source));
    assertSupplemental(JSON.parse(bytes.toString("utf8")), required.kind, report);
    supplemental[required.digest] = sha256(bytes);
    fs.writeFileSync(path.join(directory, required.sealed), bytes);
  }
  const archives = {}, expectedRuntime = {};
  for (const scope of plan.deployment.components) {
    expectedRuntime[scope] = readSourceVersion(root, scope);
    assert.equal(expectedRuntime[scope].dirty, false, "Publication source must be clean");
    const archive = path.join(directory, `${scope}.tgz`);
    if (scope === "backend") packGitRepoArchive(root, archive);
    else {
      const dist = path.join(root, "client/web/dist");
      const metadata = JSON.parse(fs.readFileSync(path.join(dist, "runtime-version.json"), "utf8"));
      assert.equal(metadata.frontend.commit, commit, "Frontend build belongs to another commit");
      assert.equal(metadata.frontend.dirty, false, "Frontend build has uncommitted inputs");
      assert.equal(metadata.frontend.sourceFingerprint, expectedRuntime.frontend.sourceFingerprint, "Frontend build source changed");
      assert.equal(metadata.backendUrl, "https://api.changmen.fun/api/runtime-version", "Production API endpoint required");
      execFileSync("tar", ["-czf", archive, "-C", dist, "."], { cwd: root, windowsHide: true });
    }
    archives[scope] = sha256(fs.readFileSync(archive));
  }
  const evidence = { format: 1, commit, candidateTree: report.identity.candidateTree, inputFingerprint: report.identity.inputFingerprint,
    planFingerprint: report.planFingerprint, report, archives, expectedRuntime, ...supplemental, verifierSha256: sha256(verifier), sealedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  return evidence;
}
export function assertArchiveEvidence(evidence, scope, archive, expectedCommit) {
  assert.equal(evidence.format, 1);
  const plan = assertAccepted(evidence.report);
  for (const required of supplementalReports(plan))
    assert.match(evidence[required.digest] ?? "", /^[a-f0-9]{64}$/, `${required.kind}: missing sealed acceptance hash`);
  assert.equal(evidence.commit, expectedCommit, "Evidence commit mismatch");
  assert.match(expectedCommit, /^[a-f0-9]{40}$/);
  assert(plan.deployment.components.includes(scope), "Component was not approved");
  assert.equal(evidence.planFingerprint, evidence.report.planFingerprint);
  assert.equal(evidence.candidateTree, evidence.report.identity.candidateTree);
  assert.equal(evidence.inputFingerprint, evidence.report.identity.inputFingerprint);
  assert.equal(sha256(fs.readFileSync(archive)), evidence.archives[scope], "Archive differs from verified artifact");
  const runtime = evidence.expectedRuntime[scope];
  assert.equal(runtime.commit, expectedCommit);
  assert.equal(runtime.dirty, false);
  assert.match(runtime.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(runtime.contractFingerprint, /^[a-f0-9]{64}$/);
  return runtime;
}
export function verifySupplementalEvidence(evidence, directory) {
  for (const required of supplementalReports(evidence.report.plan)) {
    const bytes = fs.readFileSync(path.join(directory, required.sealed));
    assert.equal(sha256(bytes), evidence[required.digest], `${required.kind}: sealed acceptance changed`);
    assertSupplemental(JSON.parse(bytes.toString("utf8")), required.kind, evidence.report);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, scope, evidenceFile, archive, expectedCommit] = process.argv.slice(2);
    if (mode === "seal") console.log(JSON.stringify({ commit: sealEvidence().commit, sealed: true }));
    else if (mode === "verify") {
      const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
      assertCandidate(evidence.report, process.cwd());
      assertArchiveEvidence(evidence, scope, archive, expectedCommit);
      verifySupplementalEvidence(evidence, path.dirname(evidenceFile));
      assert.equal(sha256(fs.readFileSync("scripts/deploy/verify-runtime.mjs")), evidence.verifierSha256);
      assert.equal(sha256(fs.readFileSync(path.join(path.dirname(evidenceFile), "verify-runtime.mjs"))), evidence.verifierSha256);
      console.log(`Verified ${scope} archive and acceptance for ${expectedCommit}`);
    } else throw Error("Expected seal or verify");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
