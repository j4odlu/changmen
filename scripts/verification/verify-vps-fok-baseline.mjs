import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";

// [changmen 扩展] The baseline manifest comes from the actual running VPS release.
const manifestPath = "scripts/verification/vps-fok-baseline.json";
const normalize = text => text.replace(/\r\n/g, "\n");
const sha = text => createHash("sha256").update(normalize(text)).digest("hex");
if (process.argv.includes("--record-captured-release")) {
  const snapshot = JSON.parse(fs.readFileSync("output/vps-fok-baseline.json", "utf8"));
  const releaseVerification = JSON.parse(fs.readFileSync("output/vps-fok-release-verification.json", "utf8"));
  assert.equal(snapshot.version, releaseVerification.version);
  assert.equal(releaseVerification.differences.length, 0);
  const protectedPath = file => /^(?:packages\/(?:client-core\/src|arb-core\/src|shared|venue-adapter(?!\/scripts))\/|client\/web\/src\/(?:stores\/(?:betting|account|orderStore\.ts|messageStore\.ts)|runtime\/|domain\/(?:betting|polymarket)|shared\/(?:betTiming|pmOrderDisplay|pfOrderDisplay|orderLink)|models\/platformAccount)|server\/backend\/core\/(?:account\/(?:order\/|order_store\.js|account_service\.js)|integrations\/(?:polymarket|predictfun)\/)|server\/backend\/proxy\/|server\/db\/(?:rds\/orders_store\.js|impl_rds\.js))/.test(file);
  const extensions = new Set([
    "client/web/src/stores/betting/a8/runA8ArbRound.ts",
    "client/web/src/stores/betting/manualBet.ts",
    "server/backend/core/account/order/dto.js",
  ]);
  const protectedFiles = Object.fromEntries(Object.entries(snapshot.hashes).filter(([file]) => protectedPath(file) && !extensions.has(file) && /\.(?:ts|js|mjs)$/.test(file)));
  fs.writeFileSync(manifestPath, `${JSON.stringify({ version: snapshot.version, capturedReleaseMatchesCommit: true, checkedReleaseFiles: releaseVerification.checkedFiles, protectedFiles }, null, 2)}\n`);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const files = Object.keys(manifest.protectedFiles);
const objects = execFileSync("git", ["cat-file", "--batch"], { input: `${files.map(file => `${manifest.version}:${file}`).join("\n")}\n`, maxBuffer: 30 * 1024 * 1024 });
let offset = 0;
for (const [file, expected] of Object.entries(manifest.protectedFiles)) {
  // The shared order writer has a narrowly checked metadata-only boundary.
  // Its complete FOK specialization is verified below; the baseline hash stays fixed.
  if (file !== "server/backend/core/account/order_store.js")
    assert.equal(sha(fs.readFileSync(file, "utf8")), expected, `FOK source changed from VPS: ${file}`);
  const end = objects.indexOf(10, offset);
  const header = objects.subarray(offset, end).toString("utf8").split(" ");
  assert.equal(header[1], "blob", `Baseline object missing: ${file}`);
  const size = Number(header[2]);
  const source = objects.subarray(end + 1, end + 1 + size).toString("utf8");
  offset = end + 1 + size + 1;
  assert.equal(sha(source), expected, `VPS manifest provenance mismatch: ${file}`);
}
// Same A8 orchestration body; only the neutral execution entry changes its import target.
const round = "client/web/src/stores/betting/a8/runA8ArbRound.ts";
assert.equal(normalize(fs.readFileSync(round, "utf8")).replace("from \"@/orderModes/router\"", "from \"@/stores/betting/autoBet/executeArbBet\""), normalize(execFileSync("git", ["show", `${manifest.version}:${round}`], { encoding: "utf8" })));
const environment = { ...process.env, FOK_PARITY_BASELINE: manifest.version };
const results = [];
for (const script of ["verify-fok-execution-parity.mjs", "verify-fok-shared-boundaries.mjs", "verify-gtc-module-isolation.mjs"]) {
  const output = execFileSync(process.execPath, [`scripts/verification/${script}`], { env: environment, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  results.push({ script, passed: true });
  fs.writeFileSync(`output/vps-${script.replace(/\.mjs$/, ".log")}`, output);
}
const result = { version: manifest.version, actualReleaseFilesVerified: manifest.checkedReleaseFiles, exactProtectedFiles: Object.keys(manifest.protectedFiles).length - 1, sharedWriterFokSpecializationChecked: true, checks: results, scope: "FOK algorithms under identical account/order/venue inputs; shared writer metadata boundary and optional GTC UI checked separately. No live order submission or production modification." };
fs.writeFileSync("output/vps-fok-verification.json", `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
