import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// [changmen 扩展] Read only: capture actual release files, never infer deployment from Git HEAD alone.
const remote = process.env.FOK_BASELINE_SSH_TARGET ?? "root@47.57.10.202";
const key = process.env.FOK_BASELINE_SSH_KEY ?? path.join(os.homedir(), ".ssh/id_ed25519_gamebet");
const baseline = JSON.parse(fs.readFileSync("scripts/verification/vps-fok-baseline.json", "utf8")).version;
const roots = ["client/web/src/", "packages/client-core/", "packages/arb-core/", "packages/api-contract/", "packages/shared/", "packages/venue-adapter/", "server/backend/core/", "server/backend/proxy/", "server/backend/http_routes.js", "server/backend/server.js", "server/storage/", "server/db/"];
const files = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline], { encoding: "utf8" }).trim().split("\n").filter(file => roots.some(root => file.startsWith(root)) && /\.(?:ts|js|mjs|vue|json)$/.test(file) && !/\.(?:test|spec)\./.test(file));
const program = `
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import {execFileSync} from 'node:child_process';
const root='/root/changmen';
const version=fs.readFileSync(path.join(root,'client/web/dist/deploy-version.txt'),'utf8').trim();
const backend=fs.realpathSync(path.join(root,'backend-current'));
const frontend=fs.realpathSync(path.join(root,'client/web/dist'));
const frontendIndexHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(frontend,'index.html'),'utf8').replace(/\\r\\n/g,'\\n')).digest('hex');
const processes=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8'})).filter(p=>p.name==='changmen-esport').map(p=>({name:p.name,cwd:p.pm2_env.pm_cwd,script:p.pm2_env.pm_exec_path,status:p.pm2_env.status}));
const files=${JSON.stringify(files)};
const sources=Object.fromEntries(files.map(file=>{const p=path.join(backend,file); return [file,fs.existsSync(p)?fs.readFileSync(p,'utf8'):null];}));
const hashes=Object.fromEntries(Object.entries(sources).map(([file,source])=>[file,source===null?null:crypto.createHash('sha256').update(source.replace(/\\r\\n/g,'\\n')).digest('hex')]));
console.log(JSON.stringify({remote:${JSON.stringify(remote)},version,backend,frontend,frontendIndexHash,processes,hashes,sources}));
`;
const result = spawnSync("ssh", ["-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", remote, "node --input-type=module"], { input: program, encoding: "utf8", maxBuffer: 35 * 1024 * 1024, timeout: 45000 });
assert.equal(result.status, 0, result.stderr || "VPS baseline capture failed");
const snapshot = JSON.parse(result.stdout);
assert.equal(snapshot.version, baseline, "VPS changed from the fixed FOK release baseline");
assert(snapshot.processes.length && snapshot.processes.every(p => p.status === "online" && p.script.startsWith(`${snapshot.backend}/`)), "Backend process must run the captured release");
// [changmen 扩展] Check the publicly served frontend as well as its release directory.
const frontendUrl = process.env.FOK_BASELINE_FRONTEND_URL ?? "https://changmen.fun";
const [versionResponse, indexResponse] = await Promise.all([
  fetch(`${frontendUrl}/deploy-version.txt`, { signal: AbortSignal.timeout(15000), cache: "no-store" }),
  fetch(`${frontendUrl}/`, { signal: AbortSignal.timeout(15000), cache: "no-store" }),
]);
assert(versionResponse.ok && indexResponse.ok, "Served frontend probe must succeed");
const servedVersion = (await versionResponse.text()).trim();
const servedIndexHash = (await import("node:crypto")).createHash("sha256")
  .update((await indexResponse.text()).replace(/\r\n/g, "\n")).digest("hex");
assert.equal(servedVersion, snapshot.version, "Served frontend version differs from captured release");
assert.equal(servedIndexHash, snapshot.frontendIndexHash, "Served frontend HTML differs from captured release");
snapshot.servedFrontend = { url: frontendUrl, version: servedVersion, indexHash: servedIndexHash, matchesCapture: true };
fs.mkdirSync("output", { recursive: true });
fs.writeFileSync("output/vps-fok-baseline.json", JSON.stringify(snapshot));
const objects = execFileSync("git", ["cat-file", "--batch"], { input: `${files.map(file => `${baseline}:${file}`).join("\n")}\n`, maxBuffer: 35 * 1024 * 1024 });
let offset = 0;
const differences = [];
for (const file of files) {
  const end = objects.indexOf(10, offset);
  const header = objects.subarray(offset, end).toString("utf8").split(" ");
  assert.equal(header[1], "blob", `Baseline source missing: ${file}`);
  const size = Number(header[2]);
  const source = objects.subarray(end + 1, end + 1 + size).toString("utf8");
  offset = end + 1 + size + 1;
  if (snapshot.sources[file]?.replace(/\r\n/g, "\n") !== source.replace(/\r\n/g, "\n"))
    differences.push(file);
}
fs.writeFileSync("output/vps-fok-release-verification.json", JSON.stringify({ version: snapshot.version, checkedFiles: files.length, differences }, null, 2));
assert.equal(differences.length, 0, `Actual release differs from commit: ${differences.join(", ")}`);
process.stdout.write(`${JSON.stringify({ version: snapshot.version, checkedActualReleaseFiles: files.length, releaseMatchesCommit: true, backendRunningCapturedRelease: true, servedFrontendMatchesCapture: true })}\n`);
