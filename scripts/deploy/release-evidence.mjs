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
import { readSourceVersion } from "../../server/storage/runtime_version.js";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
export function assertAccepted(report) {
  assert.equal(report.passed, true, "Acceptance did not pass");
  assert.equal(report.sourceStable, true, "Acceptance source changed");
  assert.equal(report.immutableFokEntries, 551, "Original FOK protection is required");
  assert.equal(planHash(report.plan), report.planFingerprint, "Recorded acceptance plan changed");
  const plan = changePlan(report.plan.changedPaths, report.plan);
  assert.equal(plan.purpose, "release", "Daily validation is not publication approval");
  assert.equal(report.plan.releasePlan, plan.releasePlan, "Release plan conflicts with component dependencies");
  assert.equal(planHash(plan), report.planFingerprint, "Acceptance plan mismatch");
  assert.equal(report.tier, plan.tier);
  assert.equal(report.completeRelease, plan.checks.includes("complete-release"));
  assert.deepEqual(report.results.map(row => ({ check: row.check, passed: row.passed })),
    plan.checks.map(check => ({ check, passed: true })), "Incomplete acceptance");
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
  let fullAcceptanceSha256 = null;
  if (report.completeRelease) {
    const bytes = fs.readFileSync(path.join(root, "output/fok-release-verdict.json"));
    const full = JSON.parse(bytes.toString("utf8"));
    assert.equal(full.passed, true); assert.equal(full.fullReleaseAccepted, true);
    assert.equal(full.results.length, 22, "Original complete acceptance evidence required");
    assert(full.results.every(row => row.passed === true));
    assert.equal(full.releasePlan, plan.releasePlan, "Complete acceptance publication plan mismatch");
    fullAcceptanceSha256 = sha256(bytes);
    fs.writeFileSync(path.join(directory, "full-acceptance.json"), bytes);
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
    planFingerprint: report.planFingerprint, report, archives, expectedRuntime, fullAcceptanceSha256, verifierSha256: sha256(verifier), sealedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  return evidence;
}
export function assertArchiveEvidence(evidence, scope, archive, expectedCommit) {
  assert.equal(evidence.format, 1);
  const plan = assertAccepted(evidence.report);
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, scope, evidenceFile, archive, expectedCommit] = process.argv.slice(2);
    if (mode === "seal") console.log(JSON.stringify({ commit: sealEvidence().commit, sealed: true }));
    else if (mode === "verify") {
      const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
      assertCandidate(evidence.report, process.cwd());
      assertArchiveEvidence(evidence, scope, archive, expectedCommit);
      if (evidence.report.completeRelease) {
        const bytes = fs.readFileSync(path.join(path.dirname(evidenceFile), "full-acceptance.json"));
        assert.equal(sha256(bytes), evidence.fullAcceptanceSha256);
        const full = JSON.parse(bytes.toString("utf8"));
        assert.equal(full.passed, true); assert.equal(full.results.length, 22);
        assert(full.results.every(row => row.passed === true));
      }
      assert.equal(sha256(fs.readFileSync("scripts/deploy/verify-runtime.mjs")), evidence.verifierSha256);
      assert.equal(sha256(fs.readFileSync(path.join(path.dirname(evidenceFile), "verify-runtime.mjs"))), evidence.verifierSha256);
      console.log(`Verified ${scope} archive and acceptance for ${expectedCommit}`);
    } else throw Error("Expected seal or verify");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
