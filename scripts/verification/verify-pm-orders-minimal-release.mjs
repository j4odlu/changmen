// [changmen 扩展] 第二阶段独立候选的完整保护入口。只读线上代码/版本；无数据库、交易或部署调用。
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {assertCaptureEvidence,checkInputHashes} from './release-provenance.mjs';
import {objectDigest,retryablePublicNetworkFailure} from './pm-orders-minimal-acceptance.mjs';
const npmPath = process.env.npm_execpath ?? path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
assert(fs.existsSync(npmPath),'Local npm runtime required');
assert.equal(process.argv.length,2,'This candidate accepts no alternate release plan or baseline');
fs.mkdirSync('output/pm-orders-minimal-protection',{recursive:true});
const evidenceRoot=`output/pm-orders-minimal-protection/runs/${Date.now()}-${randomUUID()}`;
fs.mkdirSync(`${evidenceRoot}/previous`,{recursive:true});
for(const entry of fs.readdirSync('output/pm-orders-minimal-protection',{withFileTypes:true}))if(entry.isFile())fs.copyFileSync(`output/pm-orders-minimal-protection/${entry.name}`,`${evidenceRoot}/previous/${entry.name}`);
const inputHashes=checkInputHashes(),inputDigest=objectDigest(inputHashes);
const npm=(...args)=>[npmPath,...args];
const vitest=(...args)=>npm('exec','--','vitest',...args);
const phases=[
  ['capture',['scripts/verification/capture-vps-fok-baseline.mjs']],
  ['release-files',['scripts/verification/audit-fok-release-files.mjs']],
  ['candidate-scope',['scripts/verification/verify-pm-orders-minimal-scope.mjs']],
  ['fok-core',npm('run','check:fok-parity')],
  ['vps-core',npm('run','check:fok-vps')],
  ['public-entries',['scripts/verification/verify-fok-public-entries.mjs']],
  ['protection-negative',vitest('run','scripts/verification','--maxWorkers=4','--reporter=json','--outputFile=output/pm-orders-minimal-protection/negative.json')],
  ['checks',npm('run','test:checks')],
  ['router-compile',npm('run','compile:router','--workspace=@changmen/backend')],
  ['backend',npm('run','test:backend','--','--force')],
  ['order-business',vitest('run','server/db/rds','server/backend/core/account','server/backend/core/orderModes','--exclude','server/backend/core/account/user_login_meta.test.mjs','--exclude','server/backend/core/account/user_presence.test.mjs','--reporter=json','--outputFile=output/pm-orders-minimal-protection/order-business.json')],
  ['compatibility',vitest('run','server/db/rds/pm_orders_minimal.test.mjs','server/db/rds/orders_execution_compat.test.mjs','server/backend/core/account/admin_maintenance.ordersCompat.test.mjs','scripts/verification/orders-consumer-boundary.test.mjs','scripts/migrations/pm-orders-minimal/production.test.mjs','scripts/migrations/pm-gtc-orders/plan.test.mjs','scripts/migrations/pm-gtc-orders/phase2-schema.test.mjs','scripts/migrations/pm-gtc-orders/backfill.test.mjs','scripts/migrations/pm-gtc-orders/integration/preparation.test.mjs','--reporter=json','--outputFile=output/pm-orders-minimal-protection/compatibility.json')],
  ['frontend-typecheck',npm('run','typecheck:frontend')],
  ['frontend',vitest('run','--maxWorkers=2','--reporter=json','--outputFile=../../output/pm-orders-minimal-protection/frontend.json'),'client/web'],
  ['build',npm('run','app:build')],
  ['node-tests',['--test','server/backend/core/account/user_login_meta.test.mjs','server/backend/core/account/user_presence.test.mjs','scripts/deploy/classify-deploy-scope.test.mjs','scripts/deploy/workflows.test.mjs','scripts/deploy/deploy-plan.test.mjs','scripts/deploy/compare-deployed-files.test.mjs','scripts/deploy/wait-for-backend.test.mjs']],
  ['runtime-boundaries',['scripts/verification/audit-fok-runtime-boundaries.mjs']],
  ['release-stability',['scripts/verification/verify-fok-release-stability.mjs']],
];
const results=[];
for(const [phase,args,cwd] of phases) {
  const started=Date.now(),attempts=[];let result,output;
  for(let attempt=1;attempt<=2;attempt++) {
    result=spawnSync(process.execPath,args,{cwd:cwd?path.resolve(cwd):process.cwd(),encoding:'utf8',timeout:phase==='frontend'?600000:300000,maxBuffer:30*1024*1024,windowsHide:true});
    output=(result.stdout??'')+(result.stderr??'')+(result.error?'\n'+result.error.message:'');
    const log=`${evidenceRoot}/${phase}.attempt-${attempt}.log`;fs.writeFileSync(log,output);
    const unchanged=objectDigest(checkInputHashes())===inputDigest;
    const retryable=result.status!==0 && retryablePublicNetworkFailure(phase,output);
    attempts.push({exitCode:result.status,log,inputUnchanged:unchanged,retryableNetworkFailure:retryable});
    if(result.status===0 || attempt===2 || !retryable || !unchanged)break;
    console.log(`${phase}: public TLS failure retained; one identical retry (${log})`);
  }
  const log=`output/pm-orders-minimal-protection/${phase}.log`;
  fs.writeFileSync(log,output);
  results.push({phase,passed:result.status===0&&attempts.every(a=>a.inputUnchanged),exitCode:result.status,elapsedMs:Date.now()-started,log,attempts});
  console.log(`${phase}: ${result.status===0?'PASS':'FAIL'} (${log})`);
  if(result.status!==0&&['capture','release-files'].includes(phase))break;
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const capture=results.find(row=>row.phase==='capture')?.passed?read('output/vps-fok-baseline.json'):null;
const captureReport=capture?read('output/vps-fok-release-verification.json'):null;
const runtime=results.find(row=>row.phase==='runtime-boundaries')?.passed?read('output/fok-runtime-boundary-audit.json'):null;
const publicEntry=results.find(row=>row.phase==='public-entries')?.passed?read('output/fok-public-entry-comparison.json'):null;
let evidenceConsistent=false;
if(capture&&runtime&&publicEntry&&results.find(row=>row.phase==='release-stability')?.passed) {
  assertCaptureEvidence(capture,captureReport);
  for(const report of [runtime,publicEntry])for(const key of ['captureId','frontendVersion','backendVersion','immutableBaseline'])assert.equal(report[key],capture[key],`fresh evidence mismatch: ${key}`);
  evidenceConsistent=true;
}
const inputUnchanged=objectDigest(checkInputHashes())===inputDigest;
const passed=results.length===phases.length&&results.every(row=>row.passed)&&evidenceConsistent&&inputUnchanged;
const report={checkedAt:new Date().toISOString(),passed,fullReleaseAccepted:passed,releaseScope:'pm-orders-minimal-gtc-only-default-off',immutableBaselines:['219535c8','75b1efac66625e5f2bc9884a965b244bfaf337ed'],captureId:capture?.captureId,frontendVersion:capture?.frontendVersion,backendVersion:capture?.backendVersion,results,evidenceConsistent,inputUnchanged,inputDigest,evidenceRoot,oldControlSource:'pm_gtc_executions',compatDefault:'off',productionDatabaseConnected:false,productionWrites:false,realTrading:false,committed:false,pushed:false,deployed:false,failedBoundaries:results.filter(row=>!row.passed).map(row=>row.phase)};
fs.writeFileSync('output/pm-orders-minimal-release-verdict.json',JSON.stringify(report,null,2));
fs.writeFileSync('output/pm-orders-minimal-protection/release-verdict.json',JSON.stringify(report,null,2));
fs.writeFileSync(`${evidenceRoot}/release-verdict.json`,JSON.stringify(report,null,2));
console.log(`FOK/VPS complete release protection: ${passed?'PASS':'FAIL'}`);
if(!passed)process.exitCode=1;
