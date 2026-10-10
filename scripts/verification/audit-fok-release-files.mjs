import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// [changmen 扩展] Inventory every deployable code/config/schema file, including
// collectors, matcher, lockfile and publication scripts outside the core guard.
const snapshot = JSON.parse(fs.readFileSync("output/vps-fok-baseline.json", "utf8"));
function runtime(file) {
  return /\.(?:[cm]?js|tsx?|vue|json|ya?ml|sh|sql|toml)$/.test(file)
    && !/\.(?:test|spec)\./.test(file)
    && !/(?:^|\/)(?:docs|test|tests|__tests__|output|\.ai|\.claude|\.playwright-cli)\//.test(file);
}
const files = execFileSync("git", ["ls-tree", "-r", "--name-only", snapshot.version], { encoding: "utf8" }).trim().split("\n").filter(runtime);
const program = `
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const root='/root/changmen'; const backend=fs.realpathSync(path.join(root,'backend-current'));
const version=fs.readFileSync(path.join(root,'client/web/dist/deploy-version.txt'),'utf8').trim();
const hashes=Object.fromEntries(${JSON.stringify(files)}.map(file=>{const p=path.join(backend,file);return [file,fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p,'utf8').replace(/\\r\\n/g,'\\n')).digest('hex'):null];}));
console.log(JSON.stringify({version,backend,hashes}));
`;
const key = process.env.FOK_BASELINE_SSH_KEY ?? path.join(os.homedir(), ".ssh/id_ed25519_gamebet");
const result = spawnSync("ssh", ["-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", snapshot.remote, "node --input-type=module"], { input: program, encoding: "utf8", timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
assert.equal(result.status, 0, result.stderr || "VPS file audit failed");
const deployed = JSON.parse(result.stdout);
assert.equal(deployed.version, snapshot.version, "VPS version changed during audit");
assert.equal(deployed.backend, snapshot.backend, "VPS backend release changed during audit");
const sha = source => createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
const objects = execFileSync("git", ["cat-file", "--batch"], { input: `${files.map(file => `${snapshot.version}:${file}`).join("\n")}\n`, maxBuffer: 120 * 1024 * 1024 });
let offset = 0;
const changes = [];
const releaseMismatches = [];
const localHashes = {};
for (const file of files) {
  const end = objects.indexOf(10, offset);
  const header = objects.subarray(offset, end).toString("utf8").split(" ");
  assert.equal(header[1], "blob", file);
  const size = Number(header[2]);
  const expected = sha(objects.subarray(end + 1, end + 1 + size).toString("utf8"));
  offset = end + 1 + size + 1;
  if (expected !== deployed.hashes[file])
    releaseMismatches.push(file);
  const current = fs.existsSync(file) ? sha(fs.readFileSync(file, "utf8")) : null;
  localHashes[file] = current;
  if (current !== expected)
    changes.push({ file, deployedHash: deployed.hashes[file], currentHash: current });
}
const newFiles = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split("\n").filter(runtime);
for (const file of newFiles)
  localHashes[file] = sha(fs.readFileSync(file, "utf8"));
const report = {
  version: deployed.version,
  backend: deployed.backend,
  checkedFiles: files.length,
  actualReleaseMatchesCommit: !releaseMismatches.length,
  releaseMismatches,
  changedExistingFiles: changes,
  newRuntimeFiles: newFiles,
  localHashes,
  packageLockUnchanged: localHashes["package-lock.json"] === deployed.hashes["package-lock.json"],
  scope: "Full Git-tracked code/config/schema inventory of the actual backend release and current workspace, plus untracked additions. Excludes docs/test fixtures. This inventory alone is not behavioral equivalence.",
};
fs.writeFileSync("output/fok-release-file-audit.json", `${JSON.stringify(report, null, 2)}\n`);
assert.equal(releaseMismatches.length, 0, `Actual release mismatches: ${releaseMismatches.join(", ")}`);
process.stdout.write(`${JSON.stringify({ version: report.version, checkedFiles: files.length, actualReleaseMatchesCommit: true, changedExistingFiles: changes.map(row => row.file), newRuntimeFileCount: newFiles.length, packageLockUnchanged: report.packageLockUnchanged }, null, 2)}\n`);
