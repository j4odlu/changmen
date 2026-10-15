// [changmen 扩展] 当前候选与不可变历史包分别验收。只读线上代码/版本；无数据库、交易或部署调用。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertCaptureEvidence} from './release-provenance.mjs';
import {releasePlan, selectGtcRelease} from './gtc-independent-release.mjs';
assert(process.env.npm_execpath,'Run with npm run check:fok-release');
const plan=releasePlan(process.argv.slice(2));
fs.mkdirSync('output/orders-phase2-protection',{recursive:true});
const npm=(...args)=>[process.env.npm_execpath,...args];
const vitest=(...args)=>npm('exec','--','vitest',...args);
const phases=[
  ['capture',['scripts/verification/capture-vps-fok-baseline.mjs']],
  ['release-files',['scripts/verification/audit-fok-release-files.mjs']],
  ['historical-packages',['scripts/verification/verify-historical-release-packages.mjs']],
  ['fok-core',npm('run','check:fok-parity')],
  ['vps-core',npm('run','check:fok-vps')],
  ['public-entries',['scripts/verification/verify-fok-public-entries.mjs']],
  ['reviewed-differences',['scripts/verification/verify-fok-reviewed-differences.mjs']],
  ['protection-negative',vitest('run','scripts/verification','--exclude','scripts/verification/fok-source-specialization.test.mjs','--maxWorkers=4','--reporter=json','--outputFile=output/orders-phase2-protection/negative.json')],
  ['protection-node',['--test','scripts/verification/fok-source-specialization.test.mjs']],
  ['gtc-backend-compatibility',['scripts/verification/verify-gtc-backend-compatibility.mjs',`--release-plan=${plan}`]],
  ['checks',npm('run','test:checks')],
  ['router-compile',npm('run','compile:router','--workspace=@changmen/backend')],
  ['backend',npm('run','test:backend','--','--force')],
  ['order-business',vitest('run','server/db/rds','server/backend/core/account','server/backend/core/orderModes','--exclude','server/backend/core/account/user_login_meta.test.mjs','--exclude','server/backend/core/account/user_presence.test.mjs','--reporter=json','--outputFile=output/orders-phase2-protection/order-business.json')],
  ['compatibility',vitest('run','server/db/rds/orders_execution_compat.test.mjs','server/backend/core/account/admin_maintenance.ordersCompat.test.mjs','scripts/verification/orders-consumer-boundary.test.mjs','scripts/migrations/pm-gtc-orders/plan.test.mjs','scripts/migrations/pm-gtc-orders/phase2-schema.test.mjs','scripts/migrations/pm-gtc-orders/backfill.test.mjs','scripts/migrations/pm-gtc-orders/integration/preparation.test.mjs','--reporter=json','--outputFile=output/orders-phase2-protection/compatibility.json')],
  ['frontend-typecheck',npm('run','typecheck:frontend')],
  ['native-copy-migration',vitest('run','scripts/migrations/river-gtc','--reporter=json','--outputFile=output/orders-phase2-protection/native-copy-migration.json')],
  ['frontend',vitest('run','--maxWorkers=2','--reporter=json','--outputFile=../../output/orders-phase2-protection/frontend.json'),'client/web'],
  ['build',npm('run','app:build')],
  ['node-tests',['--test','server/backend/core/account/user_login_meta.test.mjs','server/backend/core/account/user_presence.test.mjs','scripts/deploy/classify-deploy-scope.test.mjs','scripts/deploy/workflows.test.mjs','scripts/deploy/deploy-plan.test.mjs','scripts/deploy/compare-deployed-files.test.mjs','scripts/deploy/wait-for-backend.test.mjs']],
  ['runtime-boundaries',['scripts/verification/audit-fok-runtime-boundaries.mjs']],
  ['release-stability',['scripts/verification/verify-fok-release-stability.mjs']],
];
const results=[];
for(const [phase,args,cwd] of phases) {
  const started=Date.now();const result=spawnSync(process.execPath,args,{cwd:cwd?path.resolve(cwd):process.cwd(),encoding:'utf8',timeout:300000,maxBuffer:30*1024*1024,windowsHide:true});
  const log=`output/orders-phase2-protection/${phase}.log`;
  fs.writeFileSync(log,(result.stdout??'')+(result.stderr??'')+(result.error?'\n'+result.error.message:''));
  results.push({phase,passed:result.status===0,exitCode:result.status,elapsedMs:Date.now()-started,log});
  console.log(`${phase}: ${result.status===0?'PASS':'FAIL'} (${log})`);
  if(result.status!==0)break;
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
const compatibility=results.find(row=>row.phase==='gtc-backend-compatibility')&&fs.existsSync('output/gtc-backend-compatibility.json')?read('output/gtc-backend-compatibility.json'):null;
let selectedRelease=null;
// 独立保留已核对的兼容失败原因；完整成功仍要求全部阶段与来源一致性通过。
if(compatibility&&capture&&compatibility.release?.plan===plan) {
  try {
    for(const key of ['captureId','frontendVersion','backendVersion','immutableBaseline'])assert.equal(compatibility[key],capture[key]);
    const selected=selectGtcRelease(plan,compatibility.combinations);
    assert.equal(selected.passed,compatibility.passed);
    assert.equal(selected.frontendOnlyGtcCompatible,compatibility.frontendOnlyGtcCompatible);
    assert.deepEqual(selected,compatibility.release);
    selectedRelease=selected;
  } catch { /* 旧结果、缺失组合或矛盾证据均阻断当前发布。 */ }
}
const passed=results.length===phases.length&&results.every(row=>row.passed)&&evidenceConsistent&&selectedRelease?.passed===true;
const report={checkedAt:new Date().toISOString(),passed,fullReleaseAccepted:passed,releaseScope:'current-source-with-independent-frontend-backend-compatibility',releasePlan:plan,deploymentOrder:selectedRelease?.deploymentOrder??null,frontendOnlyGtcCompatible:selectedRelease?.frontendOnlyGtcCompatible??null,releaseCombinations:selectedRelease?compatibility.combinations:null,immutableBaselines:['219535c8','75b1efac66625e5f2bc9884a965b244bfaf337ed'],captureId:capture?.captureId,frontendVersion:capture?.frontendVersion,backendVersion:capture?.backendVersion,results,evidenceConsistent,executionControlSource:'client-indexeddb',orderResultStore:'rds-orders',legacyControlSource:'pm_gtc_executions',compatDefault:'off',productionDatabaseConnected:false,productionWrites:false,realTrading:false,committed:false,pushed:false,deployed:false,failedBoundaries:[...results.filter(row=>!row.passed).map(row=>row.phase),...(selectedRelease?.failedBoundaries??['gtc:missing-current-release-evidence'])]};
fs.writeFileSync('output/fok-release-verdict.json',JSON.stringify(report,null,2));
fs.writeFileSync('output/orders-phase2-protection/release-verdict.json',JSON.stringify(report,null,2));
console.log(`FOK/VPS complete release protection: ${passed?'PASS':'FAIL'}`);
if(!passed)process.exitCode=1;
