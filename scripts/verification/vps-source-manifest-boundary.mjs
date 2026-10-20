import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] 每个既有 manifest 条目都核对原始哈希并执行完整模块保护，没有文件跳过。
import { verifyClientPackageRelocation } from "./client-package-relocation.mjs";
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyProtectedSource } from './fok-exact-boundaries.mjs';
const normal=text=>text.replaceAll('\r\n','\n');
const sha=text=>createHash('sha256').update(normal(text)).digest('hex');
export function fixedManifestSources(manifest) {
  assert.equal(manifest.version,'75b1efac66625e5f2bc9884a965b244bfaf337ed');
  const files=Object.keys(manifest.protectedFiles);assert.equal(files.length,551);
  const objects=execFileSync('git',['cat-file','--batch'],{input:files.map(file=>`${manifest.version}:${file}`).join('\n')+'\n',maxBuffer:40*1024*1024});
  let offset=0;const sources={};
  for(const file of files) {
    const end=objects.indexOf(10,offset),header=objects.subarray(offset,end).toString().split(' ');assert.equal(header[1],'blob',file);
    const size=Number(header[2]);sources[file]=objects.subarray(end+1,end+1+size).toString();offset=end+1+size+1;
    assert.equal(sha(sources[file]),manifest.protectedFiles[file],`${file}: immutable manifest provenance`);
  }
  return sources;
}
export function verifyManifestSources(manifest,readSource=file=>readAdapterHistory(file,'utf8'),sources=fixedManifestSources(manifest)) {
  assert.equal(manifest.version,'75b1efac66625e5f2bc9884a965b244bfaf337ed');
  const files=Object.keys(manifest.protectedFiles);assert.equal(files.length,551);
  const baselineRead=file=>sources[file]??execFileSync('git',['show',`${manifest.version}:${file}`],{encoding:'utf8'});
  verifyClientPackageRelocation(readSource);
  const results=[];
  for(const file of files) {
    assert.equal(sha(baselineRead(file)),manifest.protectedFiles[file],`${file}: immutable manifest provenance`);
    results.push(verifyProtectedSource(file,normal(readSource(file)),baselineRead(file),readSource,baselineRead));
  }
  assert.deepEqual(results.map(row=>row.file),files,'every immutable manifest entry must have its own source protection result');
  return results;
}
