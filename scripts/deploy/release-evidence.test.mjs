import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runChangeValidation } from "../verification/verify-change.mjs";
import { assertAccepted, assertCandidate, assertArchiveEvidence, sealEvidence, sha256 } from "./release-evidence.mjs";
import { readSourceVersion } from "../../server/storage/runtime_version.js";
import { planHash } from "./change-plan.mjs";
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-evidence-"));
  git(root, "init", "-q"); fs.writeFileSync(path.join(root, "runtime.js"), "original"); git(root, "add", ".");
  git(root, "-c", "user.name=Evidence", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "fixture");
  return root;
}
test("failed, missing or downgraded checks cannot produce publication proof", () => {
  const root = fixture();
  try {
    const report = runChangeValidation(["--publish=backend"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    assertAccepted(report);
    for (const mutate of [
      p => { p.passed = false; }, p => { p.sourceStable = false; }, p => { p.immutableFokEntries = 550; },
      p => { p.results.pop(); }, p => { p.results[0].passed = false; },
      p => { p.plan.checks = ["fok-551"]; }, p => { p.plan.deployment.components = ["frontend"]; },
    ]) {
      const broken = structuredClone(report); mutate(broken); assert.throws(() => assertAccepted(broken));
    }
    const wrongCombination = structuredClone(report);
    wrongCombination.plan.releasePlan = "frontend-only"; wrongCombination.planFingerprint = planHash(wrongCombination.plan);
    assert.throws(() => assertAccepted(wrongCombination), /component dependencies/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("real Git archives and frontend build metadata seal successfully; an old build leaves no usable evidence", () => {
  const root = fixture();
  try {
    for (const dir of ["server/backend", "client/web/src", "packages/api-contract", "scripts/deploy"])
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, ".gitignore"), "output/\nclient/web/dist/\n");
    fs.writeFileSync(path.join(root, "server/backend/server.js"), "export const backend = true;");
    fs.writeFileSync(path.join(root, "client/web/src/App.vue"), "<template>app</template>");
    fs.writeFileSync(path.join(root, "packages/api-contract/package.json"), '{"version":"1"}');
    fs.copyFileSync(new URL("./verify-runtime.mjs", import.meta.url), path.join(root, "scripts/deploy/verify-runtime.mjs"));
    git(root, "add", "."); git(root, "-c", "user.name=Evidence", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "sources");
    runChangeValidation(["--publish=full"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    const dist = path.join(root, "client/web/dist"); fs.mkdirSync(dist, { recursive: true });
    const metadata = { frontend: { ...readSourceVersion(root, "frontend"), role: "frontend", startedAt: "2026-10-14T00:00:00Z" },
      backendUrl: "https://api.changmen.fun/api/runtime-version" };
    fs.writeFileSync(path.join(dist, "runtime-version.json"), JSON.stringify(metadata));
    const evidence = sealEvidence(root);
    assert.equal(evidence.fullAcceptanceSha256, null, "A routine release does not need a full audit artifact");
    assert.equal(evidence.report.completeRelease, false);
    for (const scope of ["frontend", "backend"])
      assertArchiveEvidence(evidence, scope, path.join(root, `output/release-validation/${scope}.tgz`), evidence.commit);
    metadata.frontend.commit = "b".repeat(40); fs.writeFileSync(path.join(dist, "runtime-version.json"), JSON.stringify(metadata));
    assert.throws(() => sealEvidence(root), /another commit/);
    assert.equal(fs.existsSync(path.join(root, "output/release-validation/evidence.json")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("post-check edits and other commits cannot reuse acceptance", () => {
  const root = fixture();
  try {
    const report = runChangeValidation(["--publish=backend"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    assertCandidate(report, root);
    fs.writeFileSync(path.join(root, "runtime.js"), "changed");
    assert.throws(() => assertCandidate(report, root), /Uncommitted|inputs/);
    git(root, "add", "."); git(root, "-c", "user.name=Evidence", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "another");
    assert.throws(() => assertCandidate(report, root), /Commit differs/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("the exact archive, component and source identity are bound to acceptance", () => {
  const root = fixture();
  try {
    const report = runChangeValidation(["--publish=backend"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    const archive = path.join(root, "artifact.tgz"); fs.writeFileSync(archive, "artifact");
    const commit = report.identity.commit;
    const evidence = { format: 1, commit, candidateTree: report.identity.candidateTree, inputFingerprint: report.identity.inputFingerprint,
      report, planFingerprint: report.planFingerprint, archives: { backend: sha256("artifact") },
      expectedRuntime: { backend: { commit, dirty: false, sourceFingerprint: "a".repeat(64), contractFingerprint: "b".repeat(64) } } };
    assertArchiveEvidence(evidence, "backend", archive, commit);
    assert.throws(() => assertArchiveEvidence(evidence, "backend", archive, "c".repeat(40)));
    assert.throws(() => assertArchiveEvidence(evidence, "frontend", archive, commit));
    fs.writeFileSync(archive, "changed"); assert.throws(() => assertArchiveEvidence(evidence, "backend", archive, commit), /Archive/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("passing daily checks cannot seal or authorize a release", () => {
  const root = fixture();
  try {
    const report = runChangeValidation([], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    assert.equal(report.passed, true); assert.equal(report.completeRelease, false);
    assert.throws(() => assertAccepted(report), /Daily validation/);
    assert.throws(() => sealEvidence(root), /Daily validation/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
