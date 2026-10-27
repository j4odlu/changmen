import { test } from "node:test";
import { runStorageFixture } from "./fixture.mjs";

test("every public JS specifier resolves to one native TS implementation in ESM and CJS", t => runStorageFixture(t, `
const {createRequire}=await import('node:module'); const require=createRequire(import.meta.url);
const pkg=JSON.parse(fs.readFileSync('server/storage/package.json','utf8'));
assert.equal(Object.keys(pkg.exports).length,14);
for(const [key,target] of Object.entries(pkg.exports)){
 assert(target.endsWith('.ts')); assert(!fs.existsSync(path.join('server/storage',target.replace(/\\.ts$/,'.js'))));
 const spec='@changmen/storage'+(key==='.'?'':key.slice(1));
 const esm=await import(spec),cjs=require(spec);
 for(const name of Object.keys(esm))assert.equal(esm[name],cjs[name],spec+': '+name);
}
const storage=await import('@changmen/storage'),json=await import('@changmen/storage/json_file_store.js');
assert.equal(storage.readJsonFile,json.readJsonFile); assert.equal(storage.flushJsonFileDebounced,json.flushJsonFileDebounced);
const canonical=await import('@changmen/runtime-tooling/runtime_version.js');
const version=await import('@changmen/storage/runtime_version.js'); assert.equal(version.readSourceVersion,canonical.readSourceVersion);
`));
