import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runStorageFixture } from "./fixture.mjs";

test("extensionless public specifiers share one TS implementation and reject retired JS aliases", t => runStorageFixture(t, `
const {createRequire}=await import('node:module'); const require=createRequire(import.meta.url);
const pkg=JSON.parse(fs.readFileSync('server/storage/package.json','utf8'));
assert.equal(Object.keys(pkg.exports).length,14);
for(const [key,target] of Object.entries(pkg.exports)){
 assert(!key.endsWith('.js'));
 assert(target.endsWith('.ts')); assert(!fs.existsSync(path.join('server/storage',target.replace(/\\.ts$/,'.js'))));
 const spec='@changmen/storage'+(key==='.'?'':key.slice(1));
 const esm=await import(spec),cjs=require(spec);
 for(const name of Object.keys(esm))assert.equal(esm[name],cjs[name],spec+': '+name);
 if(key!=='.'){
  await assert.rejects(import(spec+'.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  assert.throws(()=>require(spec+'.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
 }
}
const storage=await import('@changmen/storage'),json=await import('@changmen/storage/json_file_store');
assert.equal(storage.readJsonFile,json.readJsonFile); assert.equal(storage.flushJsonFileDebounced,json.flushJsonFileDebounced);
const canonical=await import('@changmen/runtime-tooling/runtime_version.js');
const version=await import('@changmen/storage/runtime_version'); assert.equal(version.readSourceVersion,canonical.readSourceVersion);
`));

test("repository consumers and maintenance scripts use the canonical storage specifiers", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 20e6 }).split("\0");
  const violations = [];
  for (const file of files) {
    if (!/\.(?:[cm]?[jt]sx?|vue|sh|ps1|bat)$/.test(file)) continue;
    // This verifier checks the archived extraction snapshot; its literal is historical evidence.
    if (file === "scripts/verification/catalog-environment-isolation.mjs") continue;
    const source = fs.readFileSync(path.join(root, file), "utf8");
    if (/@changmen\/storage\/[A-Za-z0-9_/-]+\.js\b/.test(source)) violations.push(file);
  }
  assert.deepEqual(violations, []);
});
