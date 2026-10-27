import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("native ESM/CJS share TS plugins, skip DB loading and reject retired aliases", () => {
  const source = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {createRequire,registerHooks} from 'node:module';
const require=createRequire(import.meta.url);
let dbImports=0,networkAttempts=0;
const blocked=()=>{networkAttempts++;throw Error('Network forbidden during module import');};
globalThis.fetch=blocked;net.Socket.prototype.connect=blocked;
registerHooks({resolve(spec,ctx,next){
 if(spec==='@changmen/db'){dbImports++;throw Error('DB must remain lazy');}
 if(spec==='axios')throw Error('Retired HTTP dependency must not load');
 if(spec==='@changmen/storage/load_env')return {url:'data:text/javascript;base64,'+Buffer.from('export function loadChangmenEnv() {}').toString('base64'),shortCircuit:true};
 return next(spec,ctx);
}});
const root=await import('@changmen/team-resolver'),rootCjs=require('@changmen/team-resolver');
assert.deepEqual(Object.keys(root).sort(),['baseNormSportTeamName','createSportTeamPlugin','loadAndCreatePlugin','normFootballTeamName','resolveSportTeamKey','sportPairKeyResolved'].sort());
for(const key of Object.keys(root))assert.equal(root[key],rootCjs[key]);
for(const name of ['team_db','sport_team_plugin']){
 const spec='@changmen/team-resolver/'+name;
 const esm=await import(spec), cjs=require(spec);
 for(const key of Object.keys(esm)){assert.equal(esm[key],cjs[key]);assert.equal(root[key],esm[key]);}
 await assert.rejects(import(spec+'.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
 assert.throws(()=>require(spec+'.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
}
assert.equal(dbImports,0);
assert.equal(networkAttempts,0);
const pkg=JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url),'utf8'));
assert.equal(pkg.main,'./index.ts');
assert.equal(pkg.exports['.'],'./index.ts');
assert.equal(pkg.dependencies.axios,undefined);
assert.equal(pkg.scripts.seed,undefined);
assert.equal(pkg.scripts['probe:live'],undefined);
for(const file of ['index.js','cache.js','game_map.js','normalize.js','providers/pandascore.js','seed.js','test.js','resolver.offline.test.mjs'])
 assert(!fs.existsSync(new URL('./'+file,import.meta.url)),file+' must remain retired');
const sport=await import('@changmen/team-resolver/sport_team_plugin');
assert.equal(sport.resolveSportTeamKey('曼城','epl'),'manchester city');
assert.equal(typeof (await import('@changmen/team-resolver/team_db')).loadAndCreatePlugin,'function');
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: new URL("./", import.meta.url), encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
});
