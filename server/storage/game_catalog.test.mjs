import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {expect,it} from 'vitest';

it('matches the original environment-driven catalog across unset, wildcard, aliases, whitespace and live changes, including CJS',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'changmen-catalog-environment-'));
 try{
  const record=JSON.parse(fs.readFileSync('scripts/verification/catalog-environment-isolation.json','utf8'));
  fs.writeFileSync(path.join(root,'game_catalog.ts'),record.changes.find(row=>row.file==='packages/shared/catalog/game_catalog.ts').before);
  fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  for(const name of ['game_catalog.json','game_catalog_sports.json','game_catalog_rules.js','game_catalog_rules.ts'])fs.copyFileSync('packages/shared/catalog/'+name,path.join(root,name));
  const script=`import assert from 'node:assert/strict';import net from 'node:net';import{createRequire}from'node:module';
let networkAttempts=0;const blocked=()=>{networkAttempts++;throw Error('Network forbidden');};net.Socket.prototype.connect=blocked;globalThis.fetch=blocked;
const original=await import(${JSON.stringify(pathToFileURL(path.join(root,'game_catalog.ts')).href)}),pure=await import('@changmen/shared/catalog/game_catalog'),server=await import('@changmen/storage/game_catalog.js');
const require=createRequire(import.meta.url),cjs=require('./server/platform-probes/backend/_paths.cjs').backendRequire('@changmen/storage/game_catalog.js');
for(const name of Object.keys(server))assert.equal(cjs[name],server[name]);
for(const file of ['saba','imt'])assert(Object.keys(require('./server/platform-probes/'+file+'/session.js')).length>0);
const values=[undefined,'','*','CS2','lol,cs2','CS2; \\tlol CS2','unknown','chi,mlb','  ',' * ','cs-go','valorant'];
for(const value of values){if(value===undefined)delete process.env.AGGREGATE_GAME_CODES;else process.env.AGGREGATE_GAME_CODES=value;
for(const name of ['parseActiveGameCodes','getActiveGames','getCatalogSummary']){assert.deepEqual(server[name](),original[name](),name+': '+value);assert.deepEqual(pure[name](value),original[name]());}
for(const platform of ['OB','PB','pb','Polymarket','PredictFun','XBet','SABA','IMT','unknown']){
assert.deepEqual(server.getActivePlatformGameIds(platform),original.getActivePlatformGameIds(platform));assert.deepEqual(pure.getActivePlatformGameIds(platform,value),original.getActivePlatformGameIds(platform));
for(const id of ['cs2','cs-go','lol','257578064923863','chi','unknown']){assert.equal(server.isAllowedPlatformGameId(platform,id),original.isAllowedPlatformGameId(platform,id));assert.equal(pure.isAllowedPlatformGameId(platform,id,value),original.isAllowedPlatformGameId(platform,id));}}}
const all=pure.parseActiveGameCodes(),hostProcess=globalThis.process;
try{globalThis.process=undefined;assert.deepEqual(pure.parseActiveGameCodes(),all);assert.deepEqual(pure.getCatalogSummary().activeCodes,all);assert(pure.getActivePlatformGameIds('OB').length>0);assert(pure.isAllowedPlatformGameId('PB','cs-go'));}finally{globalThis.process=hostProcess;}
assert.equal(networkAttempts,0);console.log(JSON.stringify({cases:values.length,networkAttempts,cjsIdentity:true,browserWithoutProcess:true}));`;
  const env={...process.env,NODE_OPTIONS:'',NODE_PATH:'',DATABASE_URL:'',DATABASE_URL_PUBLIC:'',DATABASE_URL_INTERNAL:''};
  const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','--eval',script],{cwd:process.cwd(),env,encoding:'utf8',windowsHide:true,timeout:20000}));
  expect(result).toEqual({cases:12,networkAttempts:0,cjsIdentity:true,browserWithoutProcess:true});
 }finally{
  const real=fs.realpathSync(root);expect(path.dirname(real)).toBe(fs.realpathSync(os.tmpdir()));expect(path.basename(real)).toMatch(/^changmen-catalog-environment-/);fs.rmSync(real,{recursive:true,force:true});
 }
},30000);
