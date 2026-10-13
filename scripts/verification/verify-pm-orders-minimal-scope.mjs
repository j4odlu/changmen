// [changmen 扩展] 固定已发布 313c19e8 候选基底；不是 FOK/VPS 基线重设。
import assert from "node:assert/strict";
import fs from "node:fs";
import {createReadonlyGitScope,verifyGitScope} from "./orders-phase2-git-scope.mjs";
import {restoreMinimalOrdersSource} from "./pm-orders-minimal-boundary.mjs";
const base="313c19e8afc30d62b54363830974b6738eab84d8",metadataPath="scripts/verification/pm-orders-minimal-scope.json";
const text=fs.readFileSync(metadataPath,"utf8"),scope=JSON.parse(text),git=createReadonlyGitScope();
const protectedRuntime=["server/backend/core/account/order/dto.js","server/backend/core/account/order_store.js","server/db/index.js","server/db/rds/orderModes/gtc/pm_gtc_store.js","server/db/rds/orderModes/read.js","server/db/rds/orders_execution_compat.js","server/db/rds/orders_store.js"];
assert.deepEqual(scope.existingRuntime,protectedRuntime,"only seven exact existing runtime boundaries");
const protectedFixtures=["server/backend/core/integrations/polymarket/clob_proxy.test.mjs"];
assert.deepEqual(scope.existingFixtures,protectedFixtures,"only explicit network fixture timeout alignment");
const result=verifyGitScope({scope,scopeText:text,fixedBase:base,metadataPath,git});
const originals=git.readBlobs(base,scope.existingRuntime),read=p=>fs.readFileSync(p,"utf8");
for(const file of scope.existingRuntime)assert.equal(restoreMinimalOrdersSource(file,read(file),read),originals[file].replaceAll("\r\n","\n"),`complete original runtime: ${file}`);
const fixtureOriginals=git.readBlobs(base,protectedFixtures);
for(const file of protectedFixtures)assert.equal(restoreMinimalOrdersSource(file,read(file),read),fixtureOriginals[file].replaceAll("\r\n","\n"),`all original fixture assertions retained: ${file}`);
const untouched=git.basePaths(base).filter(file=>/^(client|packages|server|chrome-extension|\.github)\//.test(file)&&!protectedRuntime.includes(file)&&!protectedFixtures.includes(file));
for(let offset=0;offset<untouched.length;offset+=80){
 const batch=untouched.slice(offset,offset+80),originalUntouched=git.readBlobs(base,batch);
 for(const file of batch)assert.equal(read(file).replaceAll("\r\n","\n"),originalUntouched[file].replaceAll("\r\n","\n"),`unchanged published application source: ${file}`);
}
assert.equal(read("scripts/verification/vps-fok-baseline.json").replaceAll("\r\n","\n"),git.readBlobs(base,["scripts/verification/vps-fok-baseline.json"])["scripts/verification/vps-fok-baseline.json"].replaceAll("\r\n","\n"));
fs.mkdirSync("output/pm-orders-minimal-protection",{recursive:true});fs.writeFileSync("output/pm-orders-minimal-protection/scope.json",JSON.stringify({passed:true,...result,oldControlSource:"pm_gtc_executions",defaultFlag:"off",productionDatabaseConnected:false},null,2));
console.log(JSON.stringify({passed:true,...result}));
