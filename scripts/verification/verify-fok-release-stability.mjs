import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 完整检查末尾再核验两端版本、进程、公开入口与本地检查输入没有漂移。
import fs from "node:fs";
import assert from "node:assert/strict";
import { sshRead, layoutProgram, readLayout, assertStable, readPublicAsset, checkInputHashes, localHashes, PUBLIC_ASSET_WORKERS } from "./release-provenance.mjs";
const snapshot = JSON.parse(readAdapterHistory("output/vps-fok-baseline.json", "utf8"));
const audit = JSON.parse(readAdapterHistory("output/fok-release-file-audit.json", "utf8"));
assert.equal(audit.captureId, snapshot.captureId);
const after = sshRead(layoutProgram + `
const hashes=Object.fromEntries(${JSON.stringify(Object.keys(snapshot.hashes))}.map(file=>[file,crypto.createHash('sha256').update(readAdapterHistory(path.join(backend,file),'utf8').replace(/\\r\\n/g,'\\n')).digest('hex')]));
const assets=${JSON.stringify(snapshot.reachableAssets.map(row => row.file))}.map(file=>({file,sha256:crypto.createHash('sha256').update(readAdapterHistory(path.join(frontend,file))).digest('hex')}));
console.log(JSON.stringify({...layout,hashes,assets}));`);
assertStable(snapshot, after);
assert.deepEqual(after.hashes, snapshot.hashes, "Backend files changed during checks");
for (const asset of snapshot.reachableAssets)
  assert.equal(after.assets.find(row => row.file === asset.file)?.sha256, asset.sha256, `Frontend file changed: ${asset.file}`);
const queue = [...snapshot.reachableAssets];
async function worker() {
  while (queue.length) {
    const asset = queue.shift();
    await readPublicAsset(snapshot.servedFrontend.url, asset);
  }
}
// [changmen 扩展] 与初始捕获共用有限并发和完整字节校验。
await Promise.all(Array.from({ length: PUBLIC_ASSET_WORKERS }, worker));
assertStable(snapshot, readLayout());
assert.deepEqual(localHashes(), audit.localHashes, "Local release inputs changed during checks");
assert.deepEqual(checkInputHashes(), audit.checkInputHashes, "Local verification/test inputs changed during checks");
console.log(JSON.stringify({ captureId: snapshot.captureId, frontendVersion: snapshot.frontendVersion, backendVersion: snapshot.backendVersion, immutableBaseline: snapshot.immutableBaseline, passed: true }));
