// [changmen 扩展] Offline history reader for the exact, reviewed explicit-audit policy.
// Live validation always imports the current planner; immutable migration evidence stays unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const sha = source => createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
const text = fs.readFileSync(new URL("./validation-audit-boundary.json", import.meta.url), "utf8");
assert.equal(sha(text), "66dc294f7b52e3f2f0a1c375e90169e830b7cf3cf201bd0edac56ce6a6e72888", "Explicit audit policy inventory changed");
export const VALIDATION_AUDIT_BOUNDARY = JSON.parse(text);
assert.equal(VALIDATION_AUDIT_BOUNDARY.purpose, "explicit-historical-audit-policy-only");
for (const row of VALIDATION_AUDIT_BOUNDARY.files)
  assert.equal(sha(row.before), row.beforeSha, "Original validation source changed");

// [changmen 扩展] These CI controls did not move during the workspace migration.
// Historical audits read their existing baseline; current behavior is covered by
// planner, workflow and release tests. Never freeze evolving CI to a source hash.
const liveFixtureControls = new Set([
  "scripts/verification/fok-exact-boundaries.mjs", "scripts/verification/pm-loader-bindings.mjs",
  "scripts/verification/pm-dependency-audit.mjs",
  "scripts/check-team-boundaries.mjs",
  "scripts/verification/venue-browser-relocation.mjs",
  "scripts/verification/venue-browser-stream.test.mjs",
  "scripts/verification/venue-browser-lifecycle.test.mjs",
  "scripts/verification/venue-browser-relocation.test.mjs", "scripts/verification/unified-arb-boundaries.test.mjs",
  "scripts/verification/pm-folder-release-boundary.test.mjs", "scripts/verification/esport-relocation-boundaries.test.mjs"]);
const historicalControls = new Set([...VALIDATION_AUDIT_BOUNDARY.files.map(row => row.file), ...liveFixtureControls,
  ".github/workflows/release.yml", ".github/workflows/database-compatibility.yml",
  "scripts/deploy/change-plan.mjs", "scripts/deploy/workflows.test.mjs", "scripts/deploy/release-checks.test.mjs"]);
const historicalSources = new Map();
export function readHistoricalValidationSource(file) {
  if (!historicalControls.has(file)) return undefined;
  if (!historicalSources.has(file)) historicalSources.set(file, execFileSync("git",
    ["show", `${VALIDATION_AUDIT_BOUNDARY.baseline}:${file}`], {
      cwd: new URL("../../", import.meta.url), encoding: "utf8", windowsHide: true,
    }).replaceAll("\r\n", "\n"));
  return historicalSources.get(file);
}
export function restoreValidationAuditSource(file, source) {
  // Replace only the live fixture. Historical fault overlays must survive the
  // inverse migration chain so the original changed/missing assertions still run.
  if (liveFixtureControls.has(file) && source.replaceAll("\r\n", "\n") !==
    fs.readFileSync(new URL("../../" + file, import.meta.url), "utf8").replaceAll("\r\n", "\n")) return source;
  source = readHistoricalValidationSource(file) ?? source;
  const row = VALIDATION_AUDIT_BOUNDARY.files.find(row => row.file === file);
  return row && sha(source) === row.afterSha ? row.before : source;
}
