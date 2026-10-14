// [changmen 扩展] 只读核验双端实际来源，原固定 FOK 基线独立验证且保持不变。
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { frontendSource, filesAt, gitSources, assertLayout, assertStable, assertSourceHashes, assertPublicAsset, sshRead, layoutProgram, readLayout } from "./release-provenance.mjs";
fs.mkdirSync("output", { recursive: true });
// 失败不能使用上一次成功的证据。
for (const file of ["output/vps-fok-baseline.json", "output/vps-fok-release-verification.json"])
  fs.rmSync(file, { force: true });
const layout = readLayout();
const { frontendVersion, backendVersion } = assertLayout(layout);
const backendFiles = filesAt(backendVersion);
const frontendFiles = filesAt(frontendVersion).filter(frontendSource);
const backendSourceFiles = backendFiles.filter(file => /^(?:server\/backend\/core\/|server\/db\/)/.test(file) && /\.[cm]?[jt]s$/.test(file));
const remoteProgram = `
${layoutProgram}
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const files=${JSON.stringify(backendFiles)};
const sourceFiles=new Set(${JSON.stringify(backendSourceFiles)});
const sources={}, hashes={};
for(const file of files){const target=path.join(backend,file);if(!fs.existsSync(target)){hashes[file]=null;continue;}const text=fs.readFileSync(target,'utf8');hashes[file]=sha(text.replace(/\\r\\n/g,'\\n'));if(sourceFiles.has(file))sources[file]=text;}
function assets(folder,prefix=''){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{const rel=prefix+entry.name,p=path.join(folder,entry.name);return entry.isDirectory()?assets(p,rel+'/'):[{file:rel}];});}
const allAssets=assets(frontend),byName=new Map();for(const row of allAssets){const name=path.basename(row.file);byName.set(name,[...(byName.get(name)||[]),row.file]);}
const reachable=new Set(['index.html','deploy-version.txt']),queue=['index.html'];
while(queue.length){const file=queue.shift();if(!/\\.(html|js|css|svg)$/.test(file))continue;const text=fs.readFileSync(path.join(frontend,file),'utf8');for(const name of text.match(/[A-Za-z0-9_-]+(?:\\.[a-zA-Z0-9_-]+)*\\.(?:js|css|png|svg|webp|woff2?|ttf|jpg|jpeg|gif|ico)/g)||[]){for(const asset of byName.get(name)||[]){if(!reachable.has(asset)){reachable.add(asset);queue.push(asset);}}}}
// [changmen 扩展] 历史 chunks 只列文件名；原先实际核验的全部可达资源仍读取完整字节并计算指纹。
const checkedAssets=allAssets.filter(row=>reachable.has(row.file)).map(row=>{const target=path.join(frontend,row.file);return {...row,sha256:sha(fs.readFileSync(target)),bytes:fs.statSync(target).size};});
console.log(JSON.stringify({...layout,capturedAt:new Date().toISOString(),hashes,sources,storedAssetCount:allAssets.length,assets:checkedAssets,reachableAssets:checkedAssets}));
`;
const captured = sshRead(remoteProgram);
assertStable(layout, captured);
const backendGit = gitSources(backendVersion, backendFiles), frontendGit = gitSources(frontendVersion, frontendFiles);
assertSourceHashes(backendGit, captured.hashes);
const frontendUrl = process.env.FOK_BASELINE_FRONTEND_URL ?? "https://changmen.fun";
const queue = [...captured.reachableAssets], probes = [];
async function worker() {
  while (queue.length) {
    const asset = queue.shift();
    const response = await fetch(frontendUrl + "/" + asset.file.split("/").map(encodeURIComponent).join("/"), { cache: "no-store", signal: AbortSignal.timeout(20000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    assertPublicAsset(asset, response.status, bytes);
    if (asset.file === "deploy-version.txt") assert.equal(bytes.toString().trim(), frontendVersion);
    probes.push({ file: asset.file, sha256: asset.sha256, matched: true });
  }
}
// [changmen 扩展] 避免大文件同时争抢带宽；每个资源仍须完整匹配。
await Promise.all(Array.from({ length: 1 }, worker));
assert(probes.some(row => row.file === "index.html") && probes.some(row => row.file === "deploy-version.txt"));
const manifest = JSON.parse(fs.readFileSync("scripts/verification/vps-fok-baseline.json", "utf8"));
const oldSources = gitSources(manifest.version, Object.keys(manifest.protectedFiles));
assertSourceHashes(oldSources, manifest.protectedFiles);
assertStable(captured, readLayout());
const snapshot = { ...captured, captureId: randomUUID(), remote: process.env.FOK_BASELINE_SSH_TARGET ?? "root@47.57.10.202", frontendVersion, backendVersion, immutableBaseline: manifest.version,
  sources: { ...captured.sources, ...frontendGit },
  frontendSourceEvidence: "Frontend archive contains dist only. Source is the Git commit identified by release directory, deploy state and matching publicly served version/assets; not the backend archive's client copy. This proves serving provenance, not a reproducible build.",
  servedFrontend: { url: frontendUrl, version: frontendVersion, indexHash: captured.assets.find(row => row.file === "index.html").sha256, probes, matchesCapture: true } };
fs.writeFileSync("output/vps-fok-baseline.json", JSON.stringify(snapshot));
const report = { captureId: snapshot.captureId, frontendVersion, backendVersion, immutableBaseline: manifest.version, immutableHashesVerified: Object.keys(manifest.protectedFiles).length, backendFilesChecked: backendFiles.length, frontendAssetsChecked: probes.length, backendRunningCapturedRelease: true, servedFrontendMatchesCapture: true, passed: true };
fs.writeFileSync("output/vps-fok-release-verification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
