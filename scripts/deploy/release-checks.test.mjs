// [changmen 扩展] One runner checks and seals the same committed candidate.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { runChangeValidation, validationIdentity } from "../verification/verify-change.mjs";
import { DATABASE_PHASES } from "./acceptance-contract.mjs";
import { sealEvidence, verifySupplementalEvidence, sha256 } from "./release-evidence.mjs";
import { readSourceVersion } from "../../devtools/runtime-tooling/runtime_version.js";
import { installationProof } from "./fixtures/backend-installation.mjs";
import { packBackendRepoArchive } from "./pack-git-repo.mjs";
import { routerArtifactFixture } from "./fixtures/router-artifact.mjs";

const write = (root, file, value) => {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-release-runner-"));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("changmen-release-runner-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q"); write(root, ".gitignore", "output/\nclient/web/dist/\n/node_modules\n");
  routerArtifactFixture(root);
  write(root, "server/backend/server.js", "export const backend = true;");
  write(root, "client/web/src/App.vue", "<template>app</template>");
  write(root, "scripts/deploy/verify-runtime.mjs", fs.readFileSync(new URL("./verify-runtime.mjs", import.meta.url), "utf8"));
  git("add", "."); git("-c", "user.name=Release Test", "-c", "user.email=release@example.invalid", "commit", "-qm", "fixture");
  const identity = validationIdentity(root), calls = [];
  function run(_node, args) {
    calls.push(args);
    if (args.includes("scripts/testing/backend-linux-runtime.mjs")) {
      const proof = installationProof(identity), archive = path.join(root, "output/backend-linux-runtime/backend.tgz");
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      proof.archive = { ...packBackendRepoArchive(root, archive), sha256: sha256(fs.readFileSync(archive)),
        sourceFingerprint: readSourceVersion(root, "backend").sourceFingerprint, fingerprintParity: true, browserSourcesAbsent: true };
      write(root, "output/backend-linux-runtime/verdict.json", proof);
    }
    if (args.includes("scripts/deploy/check-database-compatibility.mjs")) write(root, "output/database-compatibility/verdict.json", {
      passed: true, sourceStable: true, localOnly: true, productionWrites: false, identity,
      results: DATABASE_PHASES.map(phase => ({ phase, passed: true })),
    });
    if (args.includes("app:build")) {
      write(root, "client/web/dist/runtime-version.json", { frontend: readSourceVersion(root, "frontend"), backendUrl: "https://api.changmen.fun/api/runtime-version" });
      write(root, "client/web/dist/index.html", "<html>verified build</html>");
    }
    return { status: 0 };
  }
  return { root, run, calls };
}
for (const scope of ["frontend", "backend", "full"]) test(`${scope}: checks once and seals the exact artifacts on one runner`, t => {
  const f = fixture(t);
  const report = runChangeValidation([`--publish=${scope}`], { cwd: f.root, npm: "npm-cli.js", run: f.run });
  assert.equal(report.passed, true);
  assert.deepEqual(report.results.map(row => row.check), report.plan.checks);
  assert.equal(new Set(report.executionOrder).size, report.executionOrder.length);
  assert.equal(f.calls.filter(args => args.includes("app:build")).length, scope === "backend" ? 0 : 1);
  const evidence = sealEvidence(f.root);
  assert.deepEqual(Object.keys(evidence.archives).sort(), scope === "full" ? ["backend", "frontend"] : [scope]);
  if (scope !== "frontend") assert.equal(evidence.archives.backend, sha256(fs.readFileSync(path.join(f.root, "output/backend-linux-runtime/backend.tgz"))));
  verifySupplementalEvidence(evidence, path.join(f.root, "output/release-validation"));
});
test("a failed current check cannot seal even after an earlier successful release", t => {
  const f = fixture(t);
  assert.equal(runChangeValidation(["--publish=frontend"], { cwd: f.root, npm: "npm-cli.js", run: f.run }).passed, true);
  sealEvidence(f.root);
  const report = runChangeValidation(["--publish=frontend"], { cwd: f.root, npm: "npm-cli.js", run: () => ({ status: 23 }) });
  assert.equal(report.passed, false);
  assert.throws(() => sealEvidence(f.root), /Acceptance did not pass/);
  assert.equal(fs.existsSync(path.join(f.root, "output/release-validation/evidence.json")), false);
});
test("a push reuses its captured production baselines through checks and sealing", t => {
  const f = fixture(t);
  const git = (...args) => execFileSync("git", args, { cwd: f.root, encoding: "utf8", stdio: "pipe" }).trim();
  const base = git("rev-parse", "HEAD");
  write(f.root, "client/web/src/components/Report.vue", "<template>new</template>");
  git("add", "."); git("-c", "user.name=Release Test", "-c", "user.email=release@example.invalid", "commit", "-qm", "frontend change");
  write(f.root, "output/event.json", { before: base });
  const versions = path.join(f.root, "output/versions.json");
  write(f.root, "output/versions.json", { backend: base, frontend: base });
  const previous = { GITHUB_SHA: process.env.GITHUB_SHA, CI_DEPLOYED_VERSIONS_FILE: process.env.CI_DEPLOYED_VERSIONS_FILE };
  try {
    process.env.GITHUB_SHA = git("rev-parse", "HEAD");
    process.env.CI_DEPLOYED_VERSIONS_FILE = versions;
    const report = runChangeValidation(["--event=output/event.json"], { cwd: f.root, npm: "npm-cli.js", run: f.run });
    assert.equal(report.passed, true);
    assert.deepEqual(report.executionOrder, ["boundaries", "frontend", "build"]);
    assert.deepEqual(report.plan.deployment.components, ["frontend"]);
    assert.equal(report.plan.requiredChecks.databaseCompatibility, false);
    assert.deepEqual(Object.keys(sealEvidence(f.root).archives), ["frontend"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
