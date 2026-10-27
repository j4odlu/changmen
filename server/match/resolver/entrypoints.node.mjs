import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("native ESM/CJS share TS plugins, skip DB loading and reject retired aliases", () => {
  const source = `
import assert from 'node:assert/strict';
import {createRequire,registerHooks} from 'node:module';
const require=createRequire(import.meta.url);
let dbImports=0;
registerHooks({resolve(spec,ctx,next){
 if(spec==='@changmen/db'){dbImports++;throw Error('DB must remain lazy');}
 if(spec==='@changmen/storage/load_env')return {url:'data:text/javascript;base64,'+Buffer.from('export function loadChangmenEnv() {}').toString('base64'),shortCircuit:true};
 return next(spec,ctx);
}});
for(const name of ['team_db','sport_team_plugin']){
 const spec='@changmen/team-resolver/'+name;
 const esm=await import(spec), cjs=require(spec);
 for(const key of Object.keys(esm))assert.equal(esm[key],cjs[key]);
 await assert.rejects(import(spec+'.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
 assert.throws(()=>require(spec+'.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
}
assert.equal(dbImports,0);
const sport=await import('@changmen/team-resolver/sport_team_plugin');
assert.equal(sport.resolveSportTeamKey('曼城','epl'),'manchester city');
assert.equal(typeof (await import('@changmen/team-resolver/team_db')).loadAndCreatePlugin,'function');
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: new URL("./", import.meta.url), encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
});
