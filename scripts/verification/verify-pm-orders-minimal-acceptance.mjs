// [changmen 扩展] 本机最终入口：离线核对当前源码和明确指定的真实测试证据，无数据库或网络连接。
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from "node:path";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {checkInputHashes} from "./release-provenance.mjs";
import {assertPostgresEvidence,assertReleaseEvidence} from "./pm-orders-minimal-acceptance.mjs";
const args=process.argv.slice(2),opts={};
assert.equal(args.length,6,"Required: --postgres <acceptance.json> --legacy <acceptance.json> --out <new-report.json>");
for(let i=0;i<args.length;i+=2){assert(["--postgres","--legacy","--out"].includes(args[i])&&!Object.hasOwn(opts,args[i]),"invalid or duplicate evidence argument");opts[args[i]]=args[i+1];}
assert(!fs.existsSync(opts["--out"]),"new output file required");
const read=file=>JSON.parse(fs.readFileSync(file,"utf8")),release=read("output/pm-orders-minimal-release-verdict.json");
assertReleaseEvidence(release,checkInputHashes());
const scope=spawnSync(process.execPath,["scripts/verification/verify-pm-orders-minimal-scope.mjs"],{encoding:"utf8",windowsHide:true});assert.equal(scope.status,0,scope.stderr);
const postgres=read(opts["--postgres"]),legacy=read(opts["--legacy"]),source=file=>fs.readFileSync(file);
assertPostgresEvidence(postgres,87,source,read(path.join(path.dirname(opts["--postgres"]),"server.json")));
assertPostgresEvidence(legacy,64,source,read(path.join(path.dirname(opts["--legacy"]),"server.json")));
const report={checkedAt:new Date().toISOString(),passed:true,releaseChecksAccepted:true,productionEnablementAccepted:false,sourceUnchanged:true,captureId:release.captureId,postgresCases:87,legacyCases:64,phases:18,retries:release.results.filter(r=>r.attempts.length>1).map(r=>({phase:r.phase,attempts:r.attempts})),releaseVerdict:"output/pm-orders-minimal-release-verdict.json",postgresEvidence:opts["--postgres"],legacyEvidence:opts["--legacy"],oldControlSource:"pm_gtc_executions",projectionPauseRequiresCompatibleReads:true,productionDatabaseConnected:false,productionWrites:false,committed:false,pushed:false,deployed:false};
fs.writeFileSync(opts["--out"],JSON.stringify(report,null,2)+"\n",{flag:"wx",flush:true});console.log(JSON.stringify({passed:true,postgresCases:87,legacyCases:64,phases:18,out:opts["--out"]}));
