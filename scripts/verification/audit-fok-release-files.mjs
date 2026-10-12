// [changmen 扩展] 真实后端归档按后端 commit 校验；前端源码独立按前端 commit 比较。
import assert from "node:assert/strict";
import fs from "node:fs";
import { filesAt, gitSources, frontendSource, sha, assertStable, assertSourceHashes, sshRead, layoutProgram, localHashes, checkInputHashes, assertCaptureEvidence } from "./release-provenance.mjs";
const snapshot = JSON.parse(fs.readFileSync("output/vps-fok-baseline.json", "utf8"));
const capture = JSON.parse(fs.readFileSync("output/vps-fok-release-verification.json", "utf8"));
assertCaptureEvidence(snapshot, capture);
fs.rmSync("output/fok-release-file-audit.json", { force: true });
const files = filesAt(snapshot.backendVersion);
const deployed = sshRead(layoutProgram + `
const hashes=Object.fromEntries(${JSON.stringify(files)}.map(file=>{const p=path.join(backend,file);return [file,fs.existsSync(p)?crypto.createHash('sha256').update(fs.readFileSync(p,'utf8').replace(/\\r\\n/g,'\\n')).digest('hex'):null];}));
console.log(JSON.stringify({...layout,hashes}));`);
assertStable(snapshot, deployed);
const backend = gitSources(snapshot.backendVersion, files);
assertSourceHashes(backend, deployed.hashes);
const frontend = gitSources(snapshot.frontendVersion, filesAt(snapshot.frontendVersion).filter(frontendSource));
const hashes = localHashes();
const compare = (sources, role) => Object.entries(sources).flatMap(([file, source]) => hashes[file] === sha(source) ? [] : [{ role, file, deployedHash: sha(source), currentHash: hashes[file] ?? null }]);
const report = { captureId: snapshot.captureId, frontendVersion: snapshot.frontendVersion, backendVersion: snapshot.backendVersion, immutableBaseline: snapshot.immutableBaseline,
  checkedFiles: files.length, actualReleaseMatchesCommit: true, releaseMismatches: [],
  changedExistingFiles: [...compare(backend, "backend-archive"), ...compare(frontend, "frontend-source")],
  newRuntimeFiles: Object.keys(hashes).filter(file => !(file in backend) && !(file in frontend)), localHashes: hashes, checkInputHashes: checkInputHashes(),
  packageLockUnchanged: hashes["package-lock.json"] === deployed.hashes["package-lock.json"],
  scope: snapshot.frontendSourceEvidence };
fs.writeFileSync("output/fok-release-file-audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ frontendVersion: report.frontendVersion, backendVersion: report.backendVersion, immutableBaseline: report.immutableBaseline, checkedFiles: report.checkedFiles, actualReleaseMatchesCommit: true, changedExistingFiles: report.changedExistingFiles.length, newRuntimeFiles: report.newRuntimeFiles.length, checkInputs: Object.keys(report.checkInputHashes).length, packageLockUnchanged: report.packageLockUnchanged }));
