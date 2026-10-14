import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertRuntime, assertTransport } from "./verify-runtime.mjs";
const runtime = { role: "backend", commit: "a".repeat(40), sourceFingerprint: "b".repeat(64), contractFingerprint: "c".repeat(64), startedAt: "2026-10-14T00:00:00Z" };
const evidence = { commit: runtime.commit, expectedRuntime: { frontend: runtime, backend: runtime } };
test("identity checks detect old processes, source drift, missing startup identity and restart requirements", () => {
  assert.equal(assertRuntime("backend", { backend: runtime, restartRequired: false }, evidence).passed, true);
  for (const mutate of [
    p => { p.backend.commit = "d".repeat(40); }, p => { p.backend.sourceFingerprint = "e".repeat(64); },
    p => { p.backend.contractFingerprint = "e".repeat(64); }, p => { delete p.backend.startedAt; },
    p => { p.restartRequired = true; }, p => { p.backend.role = "frontend"; },
  ]) {
    const payload = { backend: { ...runtime }, restartRequired: false }; mutate(payload);
    assert.throws(() => assertRuntime("backend", payload, evidence));
  }
});
test("frontend independently matches its own sealed build identity", () => {
  assert.equal(assertRuntime("frontend", { frontend: { ...runtime, role: "frontend" } }, evidence).passed, true);
  assert.throws(() => assertRuntime("frontend", {}, evidence));
});
test("transport accepts explicit scoped publication but refuses local checks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "changmen-transport-"));
  try {
    const archive = path.join(root, "artifact.tgz"); fs.writeFileSync(archive, "exact artifact");
    const proof = { format: 1, commit: runtime.commit,
      archives: { backend: createHash("sha256").update(fs.readFileSync(archive)).digest("hex") },
      report: { passed: true, sourceStable: true, immutableFokEntries: 551, completeRelease: false,
        plan: { purpose: "release", deployment: { components: ["backend"] } } } };
    assertTransport("backend", proof, archive, runtime.commit);
    proof.report.plan.purpose = "change";
    assert.throws(() => assertTransport("backend", proof, archive, runtime.commit));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
