import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("native Node shares the typed normalization entry, rejects old JS and imports without DB/network", () => {
  const source = `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {createRequire,registerHooks} from 'node:module';
let networkAttempts=0;
const blocked=()=>{networkAttempts++;throw Error('Network forbidden in normalization smoke test');};
globalThis.fetch=blocked;net.Socket.prototype.connect=blocked;
registerHooks({resolve(spec,ctx,next){if(spec==='@changmen/db')throw Error('DB must not load');return next(spec,ctx);}});
const require=createRequire(import.meta.url);
const spec='@changmen/matcher/compose/normalize/native_bets';
const esm=await import(spec),cjs=require(spec);
assert.deepEqual(Object.keys(esm).sort(),['betBucketKey','cloneRawSource','nativeSourcesByMap','rawSourceForMap','sourceFromBet'].sort());
for(const key of Object.keys(esm))assert.equal(esm[key],cjs[key]);
await assert.rejects(import(spec+'.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
assert.throws(()=>require(spec+'.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
for(const stem of ['native_bets','platform_entry']){
 assert(fs.existsSync(new URL('./compose/normalize/'+stem+'.ts',import.meta.url)));
 assert(!fs.existsSync(new URL('./compose/normalize/'+stem+'.js',import.meta.url)));
}
const {collectPlatformEntries,pairKeyName}=await import('./compose/normalize/platform_entry.ts');
const row={SourceMatchID:1,Home:'A',Away:'B'};
const [entry]=collectPlatformEntries({OB:{one:row}});
assert.equal(entry.nativeRow,row);assert.equal(entry.gameCode,null);assert.equal(pairKeyName(entry),'match:name::a:b');
const buckets={'OB:m':[{SourceBetID:1,SourceHomeID:2,SourceAwayID:3,HomeOdds:'1.2349',AwayOdds:2,BetName:'[全场]-获胜'}]};
assert.equal(esm.rawSourceForMap('OB','m',0,buckets).HomeOdds,1.235);
assert.equal(esm.sourceFromBet('Polymarket',buckets['OB:m'][0]).HomeOdds,1.234);
assert.equal(networkAttempts,0);
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
