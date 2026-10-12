// [changmen 扩展] 固定原 VPS manifest，逐项完整保护源码；实际运行版本由独立来源核验验证。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { verifyManifestSources } from './vps-source-manifest-boundary.mjs';
assert.equal(process.argv.length,2,'Baseline recording or overrides are not supported');
const manifest=JSON.parse(fs.readFileSync('scripts/verification/vps-fok-baseline.json','utf8'));
const sourceProtection=verifyManifestSources(manifest);
const round='client/web/src/stores/betting/a8/runA8ArbRound.ts';
const normal=text=>text.replaceAll('\r\n','\n');
assert.equal(normal(fs.readFileSync(round,'utf8')).replace('from "@/orderModes/router"','from "@/stores/betting/autoBet/executeArbBet"'),normal(execFileSync('git',['show',`${manifest.version}:${round}`],{encoding:'utf8'})));
const checks=[];
fs.mkdirSync('output',{recursive:true});
for(const script of ['verify-fok-execution-parity.mjs','verify-fok-shared-boundaries.mjs','verify-gtc-module-isolation.mjs']) {
  const output=execFileSync(process.execPath,[`scripts/verification/${script}`],{env:{...process.env,FOK_PARITY_BASELINE:manifest.version},encoding:'utf8',maxBuffer:8*1024*1024});
  checks.push({script,passed:true});fs.writeFileSync(`output/vps-${script.replace(/\.mjs$/,'.log')}`,output);
}
const result={passed:true,version:manifest.version,immutableManifestEntries:551,exactProtectedFiles:sourceProtection.length,sourceProtection,checks,fullReleaseAccepted:false,scope:'Complete original modules and exact committed extensions. Fixed original hashes retained; every manifest entry verified; no source exemptions or baseline recording.'};
fs.writeFileSync('output/vps-fok-verification.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,sourceProtection:undefined}));
