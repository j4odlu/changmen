import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { runChangeValidation } from "../verification/verify-change.mjs";
import { assertAccepted, assertCandidate, assertArchiveEvidence, sealEvidence, sha256, verifySupplementalEvidence } from "./release-evidence.mjs";
import { DATABASE_PHASES } from "./acceptance-contract.mjs";
import { readSourceVersion } from "../../server/storage/runtime_version.js";
import { planHash } from "./change-plan.mjs";
import { checkDatabaseCompatibility } from "./check-database-compatibility.mjs";
import { installationProof } from "./fixtures/backend-installation.mjs";
import { packBackendRepoArchive } from "./pack-git-repo.mjs";
import { routerArtifactFixture } from "./fixtures/router-artifact.mjs";
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-evidence-"));
  git(root, "init", "-q");
  fs.appendFileSync(path.join(root, ".git/info/exclude"), "\nnode_modules/\n"); routerArtifactFixture(root);
  fs.writeFileSync(path.join(root, "runtime.js"), "original"); git(root, "add", ".");
  git(root, "-c", "user.name=Evidence", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "fixture");
  return root;
}
test("transport verification starts without installed workspace dependencies and still rejects missing proof", () => {
  const root = fixture();
  try {
    for (const file of [
      "scripts/deploy/compile-backend-router.mjs", "server/backend/scripts/ensure-router-compiled.mjs",
      "scripts/deploy/release-evidence.mjs", "scripts/deploy/change-plan.mjs",
      "scripts/deploy/classify-deploy-scope.mjs", "scripts/deploy/pack-git-repo.mjs",
      "scripts/deploy/acceptance-contract.mjs", "scripts/verification/verify-change.mjs",
      "scripts/deploy/verify-backend-processes.mjs",
      "scripts/verification/validation-plan.mjs", "server/storage/runtime_version.js",
      "devtools/runtime-tooling/runtime_version.js", "devtools/runtime-tooling/package.json",
    ]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(new URL(`../../${file}`, import.meta.url), target);
    }
    fs.unlinkSync(path.join(root, "node_modules"));
    assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
    for (const scope of ["backend", "frontend"]) {
      const result = spawnSync(process.execPath, ["scripts/deploy/release-evidence.mjs", "verify", scope,
        "missing-proof.json", "missing-archive.tgz", "a".repeat(40)], { cwd: root, encoding: "utf8", windowsHide: true });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /ENOENT.*missing-proof\.json/);
      assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
    }
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function proofs(root, acceptance) {
  const common = { passed: true, sourceStable: true, identity: acceptance.identity };
  const database = { ...common, localOnly: true, productionWrites: false,
    results: DATABASE_PHASES.map(phase => ({ phase, passed: true })) };
  fs.mkdirSync(path.join(root, "output/database-compatibility"), { recursive: true });
  fs.writeFileSync(path.join(root, "output/database-compatibility/verdict.json"), JSON.stringify(database));
  const installation = installationProof(acceptance.identity);
  const archive = path.join(root, "output/backend-linux-runtime/backend.tgz");
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  installation.archive = { ...packBackendRepoArchive(root, archive), sha256: sha256(fs.readFileSync(archive)),
    sourceFingerprint: readSourceVersion(root, "backend").sourceFingerprint, fingerprintParity: true, browserSourcesAbsent: true };
  fs.mkdirSync(path.join(root, "output/backend-linux-runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, "output/backend-linux-runtime/verdict.json"), JSON.stringify(installation));
  return { database, installation };
}

for (const [directory, label] of [["client/packages/book", "relocated-package"], ["devtools/runtime-tooling", "relocated-Node-tool"]])
test(`a stale ${label} build fingerprint cannot seal even with the current commit identity`, () => {
  const root = fixture();
  const write = (file, source) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), source); };
  try {
    write(".gitignore", "output/\nclient/web/dist/\n");
    write("server/backend/server.js", "export const backend = true;");
    write("client/web/src/App.vue", "<template>app</template>");
    write(`${directory}/src/book.ts`, "export const book = 1;");
    write("packages/api-contract/package.json", '{"version":"1"}');
    write("scripts/deploy/verify-runtime.mjs", fs.readFileSync(new URL("./verify-runtime.mjs", import.meta.url)));
    git(root, "add", "."); git(root, "-c", "user.name=Evidence", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "sources");
    const previous = readSourceVersion(root, "frontend");
    let acceptance = runChangeValidation(["--publish=frontend"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    proofs(root, acceptance);
    const metadata = { frontend: { ...previous, role: "frontend", startedAt: "2026-10-14T00:00:00Z" },
      backendUrl: "https://api.changmen.fun/api/runtime-version" };
    write("client/web/dist/runtime-version.json", JSON.stringify(metadata));
    assert.equal(sealEvidence(root).expectedRuntime.frontend.sourceFingerprint, previous.sourceFingerprint);
    write(`${directory}/src/book.ts`, "export const book = 2;");
    git(root, "add", "."); git(root, "-c", "user.name=Evidence", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "relocated source changed");
    const current = readSourceVersion(root, "frontend");
    assert.notEqual(current.sourceFingerprint, previous.sourceFingerprint);
    acceptance = runChangeValidation(["--publish=frontend"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    proofs(root, acceptance);
    // Deliberately pair current commit/clean flags with an old source fingerprint.
    metadata.frontend.commit = current.commit;
    write("client/web/dist/runtime-version.json", JSON.stringify(metadata));
    assert.throws(() => sealEvidence(root), /Frontend build source changed/);
    assert.equal(fs.existsSync(path.join(root, "output/release-validation/evidence.json")), false);
  } finally {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("changmen-evidence-")) throw Error("Unexpected evidence fixture cleanup target");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("failed, missing or downgraded checks cannot produce publication proof", () => {
  const root = fixture();
  try {
    const report = runChangeValidation(["--publish=backend"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    assertAccepted(report);
    for (const mutate of [
      p => { p.passed = false; }, p => { p.sourceStable = false; }, p => { p.immutableFokEntries = 550; },
      p => { p.results.pop(); }, p => { p.results[0].passed = false; },
      p => { p.results[0].exitCode = 1; }, p => { p.results[0].errorCode = "ETIMEDOUT"; }, p => { p.results[0].signal = "SIGTERM"; },
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
    let acceptance = runChangeValidation(["--publish=full"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    assert.equal(fs.existsSync(path.join(root, "output/fok-release-verdict.json")), false);
    assert.throws(() => sealEvidence(root), /ENOENT/);
    acceptance = runChangeValidation(["--publish=full"], { cwd: root, npm: "npm-cli.js", run: () => ({ status: 0 }) });
    const proof = proofs(root, acceptance);
    for (const [file, valid] of [["output/database-compatibility/verdict.json", proof.database]]) {
      for (const mutate of [p => { p.identity.commit = "b".repeat(40); }, p => { p.identity.inputFingerprint = "c".repeat(64); },
        p => { p.results.pop(); }, p => { p.results[0].passed = false; }, p => { p.results[1] = p.results[0]; }, p => { p.sourceStable = false; }]) {
        const broken = structuredClone(valid); mutate(broken); fs.writeFileSync(path.join(root, file), JSON.stringify(broken));
        assert.throws(() => sealEvidence(root)); assert.equal(fs.existsSync(path.join(root, "output/release-validation/evidence.json")), false);
      }
      fs.writeFileSync(path.join(root, file), JSON.stringify(valid));
    }
    const dist = path.join(root, "client/web/dist"); fs.mkdirSync(dist, { recursive: true });
    const metadata = { frontend: { ...readSourceVersion(root, "frontend"), role: "frontend", startedAt: "2026-10-14T00:00:00Z" },
      backendUrl: "https://api.changmen.fun/api/runtime-version" };
    fs.writeFileSync(path.join(dist, "runtime-version.json"), JSON.stringify(metadata));
    const evidence = sealEvidence(root);
    assert.equal(evidence.fullAcceptanceSha256, null);
    assert.match(evidence.databaseAcceptanceSha256, /^[a-f0-9]{64}$/);
    assert.equal(evidence.report.completeRelease, false);
    assert.equal(evidence.report.immutableFokEntries, 0);
    verifySupplementalEvidence(evidence, path.join(root, "output/release-validation"));
    const changedReference = structuredClone(evidence);
    changedReference.report.results[0].reusedFrom = { kind: "full", phase: "vps-core" };
    assert.throws(() => assertAccepted(changedReference.report), /Unapproved reuse/);
    fs.appendFileSync(path.join(root, "output/release-validation/database-acceptance.json"), " ");
    assert.throws(() => verifySupplementalEvidence(evidence, path.join(root, "output/release-validation")), /changed/);
    for (const scope of ["frontend", "backend"])
      assertArchiveEvidence(evidence, scope, path.join(root, `output/release-validation/${scope}.tgz`), evidence.commit);
    const installationFile = path.join(root, "output/backend-linux-runtime/verdict.json");
    const wrongArtifact = structuredClone(proof.installation); wrongArtifact.archive.sha256 = "f".repeat(64);
    fs.writeFileSync(installationFile, JSON.stringify(wrongArtifact));
    assert.throws(() => sealEvidence(root), /Backend archive differs from Linux-tested artifact/);
    assert.equal(fs.existsSync(path.join(root, "output/release-validation/evidence.json")), false);
    fs.writeFileSync(installationFile, JSON.stringify(proof.installation));
    metadata.frontend.commit = "b".repeat(40); fs.writeFileSync(path.join(dist, "runtime-version.json"), JSON.stringify(metadata));
    assert.throws(() => sealEvidence(root), /another commit/);
    assert.equal(fs.existsSync(path.join(root, "output/release-validation/evidence.json")), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("maintenance-only pushes require one source-bound five-phase proof even with no application archives", () => {
  const root = fixture(), originalSha = process.env.GITHUB_SHA;
  const originalDeployedVersions = process.env.CI_DEPLOYED_VERSIONS_FILE;
  try {
    // This synthetic repository has its own history, independent of the CI checkout.
    delete process.env.CI_DEPLOYED_VERSIONS_FILE;
    fs.writeFileSync(path.join(root, ".gitignore"), "output/\n");
    fs.mkdirSync(path.join(root, "scripts/deploy"), { recursive: true });
    fs.copyFileSync(new URL("./verify-runtime.mjs", import.meta.url), path.join(root, "scripts/deploy/verify-runtime.mjs"));
    git(root, "add", "."); git(root, "-c", "user.name=Evidence", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "setup");
    const before = git(root, "rev-parse", "HEAD");
    fs.mkdirSync(path.join(root, "server/backend/db/migrations"), { recursive: true });
    fs.writeFileSync(path.join(root, "server/backend/db/migrations/fixture.sql"), "-- fixture only\n");
    git(root, "add", "."); git(root, "-c", "user.name=Evidence", "-c", "user.email=evidence@example.invalid", "commit", "-qm", "maintenance");
    process.env.GITHUB_SHA = git(root, "rev-parse", "HEAD");
    fs.mkdirSync(path.join(root, "output"), { recursive: true });
    fs.writeFileSync(path.join(root, "output/event.json"), JSON.stringify({ before }));
    let dbCalls = 0, phaseCalls = 0;
    const verify = ({ fail = false, proof = false } = {}) => runChangeValidation(["--event=output/event.json"], {
      cwd: root, npm: "npm-cli.js", run: (_node, args) => {
        if (args.includes("scripts/deploy/check-database-compatibility.mjs")) {
          dbCalls++;
          if (fail) return { status: 23 };
          if (proof) checkDatabaseCompatibility({ cwd: root, env: {}, run: () => { phaseCalls++; return { status: 0 }; } });
        }
        return { status: 0 };
      },
    });
    const failed = verify({ fail: true });
    assert.equal(failed.passed, false); assert.equal(dbCalls, 1);
    assert.deepEqual(failed.plan.deployment.components, []);
    assert.throws(() => sealEvidence(root), /Acceptance did not pass/);
    dbCalls = 0;
    const missing = verify();
    assert.equal(missing.passed, true); assert.equal(dbCalls, 1);
    assert.throws(() => sealEvidence(root), /ENOENT/, "A successful process exit is insufficient without its proof");
    dbCalls = 0;
    const accepted = verify({ proof: true });
    assert.equal(dbCalls, 1); assert.equal(phaseCalls, 5);
    assert.equal(accepted.plan.requiredChecks.completeRelease, false);
    assert.equal(accepted.plan.requiredChecks.databaseCompatibility, true);
    const evidence = sealEvidence(root);
    assert.deepEqual(evidence.archives, {});
    assert.match(evidence.databaseAcceptanceSha256, /^[a-f0-9]{64}$/);
    verifySupplementalEvidence(evidence, path.join(root, "output/release-validation"));
    const reportFile = path.join(root, "output/database-compatibility/verdict.json");
    const valid = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    for (const mutate of [p => { p.identity.commit = "b".repeat(40); }, p => { p.results.pop(); }]) {
      const invalid = structuredClone(valid); mutate(invalid);
      fs.writeFileSync(reportFile, JSON.stringify(invalid));
      assert.throws(() => sealEvidence(root));
      assert.equal(fs.existsSync(path.join(root, "output/release-validation/evidence.json")), false);
    }
    const downgraded = structuredClone(accepted);
    downgraded.plan.requiredChecks.databaseCompatibility = false;
    downgraded.plan.checks = downgraded.plan.checks.filter(check => check !== "database-compatibility");
    downgraded.results = downgraded.results.filter(row => row.check !== "database-compatibility");
    downgraded.planFingerprint = planHash(downgraded.plan);
    assert.throws(() => assertAccepted(downgraded), /plan mismatch/i);
  } finally {
    if (originalSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = originalSha;
    if (originalDeployedVersions === undefined) delete process.env.CI_DEPLOYED_VERSIONS_FILE;
    else process.env.CI_DEPLOYED_VERSIONS_FILE = originalDeployedVersions;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
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
      fullAcceptanceSha256: "d".repeat(64), databaseAcceptanceSha256: "e".repeat(64), backendInstallationSha256: "f".repeat(64),
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
