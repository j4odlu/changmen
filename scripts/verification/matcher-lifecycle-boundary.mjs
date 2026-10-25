// [changmen 扩展] Exact matcher lifecycle changes, without rewriting relocation evidence.
// This reader is used only by offline historical proofs; it never changes runtime loading.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
const sha=source=>createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
const nativeRead=file=>fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const text=fs.readFileSync(new URL('./matcher-lifecycle-increments.json',import.meta.url),'utf8');
assert.equal(sha(text),'eaa324f3dbb1ebc7cba12ed5c79dc1915e031ba22641362a9be250e60c8d9c73','Matcher lifecycle inventory changed');
export const MATCHER_LIFECYCLE_INCREMENTS=JSON.parse(text);
assert.equal(MATCHER_LIFECYCLE_INCREMENTS.purpose,'matcher-end-preserves-platform-associations');
const rows=new Map(MATCHER_LIFECYCLE_INCREMENTS.files.map(row=>{
 assert.equal(sha(row.before),row.beforeSha,row.file+': original matcher snapshot changed');
 return [row.file,row];
}));
const wiring=new Map(MATCHER_LIFECYCLE_INCREMENTS.wiring.map(row=>{
 assert.equal(sha(row.before),row.beforeSha,row.file+': original verification snapshot changed');
 return [row.file,row];
}));
function verifyAssets(read){
 for(const asset of MATCHER_LIFECYCLE_INCREMENTS.assets)
  assert.equal(sha(read(asset.file)),asset.sha,asset.file+': matcher lifecycle implementation changed');
}
export function restoreMatcherLifecycleSource(file,source,read=nativeRead){
 const row=rows.get(file);
 if(!row||sha(source)!==row.afterSha)return source;
 verifyAssets(read);
 return row.before;
}
export function restoreMatcherLifecycleVerificationSource(file,source,read=nativeRead){
 const row=wiring.get(file);
 if(!row||sha(source)!==row.afterSha)return source;
 verifyAssets(read);
 return row.before;
}
export function verifyMatcherLifecycleSources(read=nativeRead){
 for(const row of rows.values())
  assert.equal(sha(read(row.file)),row.afterSha,row.file+': unreviewed matcher lifecycle change');
 verifyAssets(read);
 for(const row of wiring.values())
  assert.equal(sha(read(row.file)),row.afterSha,row.file+': unreviewed matcher verification wiring');
 return {files:rows.size,assets:MATCHER_LIFECYCLE_INCREMENTS.assets.length,wiring:wiring.size};
}
