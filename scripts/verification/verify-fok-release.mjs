import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

// [changmen 扩展] A release verdict includes transport/state boundaries. Core
// parity alone cannot authorize publication. All VPS access below is read-only.
assert(process.env.npm_execpath, "Run with npm run check:fok-release");
fs.mkdirSync("output", { recursive: true });
const phases = [
  ["capture", ["scripts/verification/capture-vps-fok-baseline.mjs"]],
  ["release-files", ["scripts/verification/audit-fok-release-files.mjs"]],
  ["core", [process.env.npm_execpath, "run", "check:fok-vps"]],
  ["public-entries", ["scripts/verification/verify-fok-public-entries.mjs"]],
  ["checks", [process.env.npm_execpath, "run", "test:checks"]],
  ["frontend", [process.env.npm_execpath, "run", "test:frontend"]],
  ["backend", [process.env.npm_execpath, "run", "test", "--workspace=@changmen/backend"]],
  ["order-business", [process.env.npm_execpath, "exec", "--", "vitest", "run", "server/backend/core/orderModes", "server/backend/core/account/order", "server/backend/core/account/order_store.test.mjs", "server/backend/core/account/order_store_link.test.mjs", "server/backend/core/account/report_service.test.mjs", "server/backend/core/account/player_ownership.test.mjs", "server/db/rds/orders_store.test.mjs", "server/db/rds/orderModes"]],
  ["build", [process.env.npm_execpath, "run", "app:build"]],
  ["runtime-boundaries", ["scripts/verification/audit-fok-runtime-boundaries.mjs"]],
];
const results = [];
for (const [phase, args] of phases) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 300000, maxBuffer: 20 * 1024 * 1024 });
  const log = `output/fok-release-${phase}.log`;
  fs.writeFileSync(log, `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}\n` : ""}`);
  results.push({ phase, passed: result.status === 0, exitCode: result.status, log, elapsedMs: Date.now() - started });
  process.stdout.write(`${phase}: ${result.status === 0 ? "PASS" : "FAIL"} (${log})\n`);
  // A failed provenance capture cannot be replaced with an earlier snapshot.
  if (result.status !== 0 && ["capture", "release-files"].includes(phase))
    break;
}
const evidence = results.some(row => row.phase === "runtime-boundaries")
  ? JSON.parse(fs.readFileSync("output/fok-runtime-boundary-audit.json", "utf8"))
  : null;
const report = {
  checkedAt: new Date().toISOString(),
  passed: results.length === phases.length && results.every(row => row.passed),
  baseline: evidence?.version ?? null,
  results,
  failedBoundaries: evidence?.findings.filter(row => !row.passed).map(row => row.id) ?? [],
  scope: "Current workspace compared to a freshly captured VPS release. No commit, push, deployment, real bet, sell, cancel or database mutation. New GTC-specific UI is an intentional addition, not byte-for-byte VPS UI parity.",
};
fs.writeFileSync("output/fok-release-verdict.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`FOK release verdict: ${report.passed ? "PASS" : "FAIL"}\n`);
if (!report.passed)
  process.exitCode = 1;
