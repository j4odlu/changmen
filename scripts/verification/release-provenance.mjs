// [changmen 扩展] 双端独立来源验证；实际版本与不可变 FOK 基线是两份证据。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
export const runtime = file => /\.(?:[cm]?js|tsx?|vue|json|ya?ml|sh|sql|toml)$/.test(file)
  && !/\.(?:test|spec)\./.test(file)
  && !/(?:^|\/)(?:docs|test|tests|__tests__|output|\.ai|\.claude|\.playwright-cli)\//.test(file);
export const frontendSource = file => /^(?:client\/web\/src\/|packages\/(?:client-core|arb-core|api-contract|shared|venue-adapter)\/)/.test(file);
export const sha = source => createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
export const rawSha = bytes => createHash("sha256").update(bytes).digest("hex");
export const filesAt = version => execFileSync("git", ["ls-tree", "-r", "--name-only", version], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim().split("\n").filter(runtime);
export function gitSources(version, files) {
  const objects = execFileSync("git", ["cat-file", "--batch"], { input: files.map(file => `${version}:${file}`).join("\n") + "\n", maxBuffer: 120 * 1024 * 1024 });
  let offset = 0; const sources = {};
  for (const file of files) {
    const end = objects.indexOf(10, offset), header = objects.subarray(offset, end).toString("utf8").split(" ");
    assert.equal(header[1], "blob", `Missing ${version}:${file}`); const size = Number(header[2]);
    sources[file] = objects.subarray(end + 1, end + 1 + size).toString("utf8"); offset = end + 1 + size + 1;
  }
  return sources;
}
export function assertLayout(layout) {
  const version = layout.version;
  assert.match(version, /^[a-f0-9]{40}$/, "Frontend version must be a complete commit");
  const frontendVersion = layout.frontend.match(/^\/root\/changmen\/\.releases\/frontend\/frontend-([a-f0-9]{40})-\d+-\d+$/)?.[1];
  const backendVersion = layout.backend.match(/^\/root\/changmen\/\.releases\/backend\/backend-([a-f0-9]{40})-\d+-\d+$/)?.[1];
  assert.equal(frontendVersion, version, "Frontend path/version mismatch");
  assert(backendVersion, "Backend release path must identify its own complete commit");
  for (const [role, commit] of [["frontend", version], ["backend", backendVersion]]) {
    assert.match(layout.markers[role], /^\d+ [a-f0-9]{40}$/, `${role} state format`);
    assert.equal(layout.markers[role].split(" ")[1], commit, `${role} state/version mismatch`);
  }
  assert.equal(layout.processes.length, 1, "Exactly one backend process must be captured");
  const p = layout.processes[0];
  assert.equal(p.name, "changmen-esport"); assert.equal(p.status, "online"); assert(p.pid > 0);
  assert.equal(p.cwd, `${layout.backend}/server/backend`);
  assert.equal(p.script, `${layout.backend}/server/backend/scripts/start-db.mjs`);
  return { frontendVersion: version, backendVersion };
}
export function assertStable(before, after) {
  assertLayout(before); assertLayout(after);
  for (const field of ["version", "frontend", "backend", "markers", "processes"])
    assert.deepEqual(after[field], before[field], `Release changed during checks: ${field}`);
}
export function assertSourceHashes(sources, hashes) {
  for (const [file, source] of Object.entries(sources))
    assert.equal(hashes[file], sha(source), `Actual backend source differs from its commit: ${file}`);
}
export function assertPublicAsset(asset, status, bytes) {
  assert(status >= 200 && status < 300, `Public asset HTTP failure: ${asset.file}`);
  assert.equal(rawSha(bytes), asset.sha256, `Public asset differs from actual frontend: ${asset.file}`);
}
export function sshRead(program, { spawn = spawnSync } = {}) {
  const remote = process.env.FOK_BASELINE_SSH_TARGET ?? "root@47.57.10.202";
  const key = process.env.FOK_BASELINE_SSH_KEY ?? path.join(os.homedir(), ".ssh/id_ed25519_gamebet");
  // [changmen 扩展] 压缩原 JSON 后发送；不依赖 SSH 压缩协商，不删减捕获内容。
  const input = `import { gzipSync as __captureGzip } from 'node:zlib';
console.log = value => {
  if (typeof value !== 'string') throw new Error('Capture must output one JSON string');
  process.stdout.write('CHANGMEN_CAPTURE_GZIP_V1:' + __captureGzip(Buffer.from(value)).toString('base64') + '\\n');
};\n` + program;
  const result = spawn("ssh", ["-C", "-i", key, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", remote, "node --input-type=module"], { input, encoding: "utf8", timeout: 45000, maxBuffer: 45 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || `VPS read-only capture failed (${result.error?.code ?? result.status}; received ${Buffer.byteLength(result.stdout ?? "")} bytes)`);
  const match = result.stdout.trim().match(/^CHANGMEN_CAPTURE_GZIP_V1:((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/);
  assert(match && match[1], "Missing/incomplete compressed capture");
  const bytes = gunzipSync(Buffer.from(match[1], 'base64'), { maxOutputLength: 45 * 1024 * 1024 });
  return JSON.parse(bytes.toString('utf8'));
}
export const layoutProgram = `
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import {execFileSync} from 'node:child_process';
const root='/root/changmen',backend=fs.realpathSync(root+'/backend-current'),frontend=fs.realpathSync(root+'/client/web/dist');
const layout={version:fs.readFileSync(frontend+'/deploy-version.txt','utf8').trim(),backend,frontend,markers:{frontend:fs.readFileSync(root+'/.deploy-state/frontend','utf8').trim(),backend:fs.readFileSync(root+'/.deploy-state/backend','utf8').trim()},processes:JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8'})).filter(p=>p.name==='changmen-esport').map(p=>({name:p.name,pid:p.pid,status:p.pm2_env.status,cwd:p.pm2_env.pm_cwd,script:p.pm2_env.pm_exec_path}))};
`;
export const readLayout = () => sshRead(layoutProgram + "console.log(JSON.stringify(layout));");
export function currentInventory(filter = runtime) {
  // -z 保留含空格/非 ASCII 路径；全仓扫描，不通过目录豁免漏掉新文件。
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0").filter(file => filter(file) && fs.existsSync(file));
}
export function localHashes() {
  return Object.fromEntries([...new Set(currentInventory())].sort().map(file => [file, sha(fs.readFileSync(file, "utf8"))]));
}
export function checkInputHashes() {
  const files = currentInventory(file => /\.(?:[cm]?js|tsx?|vue|json|ya?ml|sh|sql|toml)$/.test(file)
    && !/(?:^|\/)(?:docs|output|\.ai|\.claude|\.playwright-cli)\//.test(file));
  return Object.fromEntries([...new Set(files)].sort().map(file => [file, sha(fs.readFileSync(file, "utf8"))]));
}
export function assertCaptureEvidence(snapshot, report) {
  assert.match(snapshot.captureId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/, "Fresh capture identity required");
  for (const field of ["captureId", "frontendVersion", "backendVersion", "immutableBaseline"])
    assert.equal(report[field], snapshot[field], `Stale/mismatched evidence: ${field}`);
  assert.equal(report.passed, true, "Capture must have passed");
}
