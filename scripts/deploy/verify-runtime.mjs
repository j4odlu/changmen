/** [changmen 扩展] Verify the served/loaded identity before recording publication success. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
export function assertTransport(scope, evidence, archive, commit) {
  assert.equal(evidence.format, 1);
  assert.equal(evidence.commit, commit, "Transport commit mismatch");
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(evidence.report.passed, true);
  assert.equal(evidence.report.sourceStable, true);
  assert.equal(evidence.report.immutableFokEntries, 551);
  assert.equal(evidence.report.plan.purpose, "release", "Local checks cannot authorize transport");
  assert(evidence.report.plan.deployment.components.includes(scope));
  assert.equal(createHash("sha256").update(fs.readFileSync(archive)).digest("hex"), evidence.archives[scope], "Transport archive mismatch");
}
export function assertRuntime(scope, payload, evidence) {
  const runtime = payload?.[scope], expected = evidence.expectedRuntime[scope];
  assert(expected && runtime?.role === scope, "Runtime role unavailable");
  assert.equal(runtime.commit, evidence.commit, "Old/wrong runtime commit");
  assert.equal(runtime.sourceFingerprint, expected.sourceFingerprint, "Runtime source fingerprint mismatch");
  assert.equal(runtime.contractFingerprint, expected.contractFingerprint, "Runtime contract fingerprint mismatch");
  assert(Number.isFinite(Date.parse(runtime.startedAt)), "Runtime startup identity missing");
  if (scope === "backend") assert.equal(payload.restartRequired, false, "Backend has not loaded current source");
  return { passed: true, scope, commit: runtime.commit, sourceFingerprint: runtime.sourceFingerprint,
    contractFingerprint: runtime.contractFingerprint, startedAt: runtime.startedAt,
    ...(scope === "backend" ? { database: payload.database } : {}) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [scope, evidenceFile, output, commit, component] = process.argv.slice(2);
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
    if (scope === "needs-backend") process.exit(evidence.report.plan.deployment.components.includes("backend") ? 0 : 1);
    if (scope === "archive") { assertTransport(component, evidence, output, commit); process.exit(0); }
    let text = ""; for await (const chunk of process.stdin) text += chunk;
    const report = assertRuntime(scope, JSON.parse(text), evidence);
    fs.writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
