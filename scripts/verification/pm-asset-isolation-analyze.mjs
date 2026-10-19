import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Reproducible bounded browser evidence; never authorizes deployment.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const base = 'output/playwright/pm-asset-isolation';
const read = withAdapterHistoryReader(name => JSON.parse(readAdapterHistory(`${base}/${name}.json`, 'utf8')));
const hash = value => createHash('sha256').update(value).digest('hex');
const count = (rows, key) => rows.reduce((out,row) => { const k=key(row); out[k]=(out[k]??0)+1; return out; },{});
const live = ['live-cold','live-off','live-late'].map(read), replay = read('replay-summary');
const controlled = read('asset-isolation-controlled'), lifecycle=read('lifecycle'), gates=read('browser-gates');
const resource=read('resource-heap'), native=read('native-hidden-start'), recording=read('recording');
const liveEnd=Date.parse(live[2].startedAt)+live[2].durationMs;
const coverage = (rows,n) => {
  let snapshots=0,eligible=0,missing=0,stale=0; const reasons={};
  for (const t of rows) {
    if (!t.worker || t.failure || !t.coverage) { missing++; continue; }
    if (t.wallAt-t.coverage.at>2000 || t.wallAt<t.coverage.at) { stale++; continue; }
    snapshots+=t.coverage.snapshotFresh; eligible+=t.coverage.eligible;
    for(const [key,value] of Object.entries(t.coverage.misses)) reasons[key]=(reasons[key]??0)+value;
  }
  return {samples:rows.length,assetObservations:rows.length*n,snapshots,eligible,missing,stale,
    snapshotRatio:rows.length?snapshots/(rows.length*n):null,eligibleRatio:rows.length?eligible/(rows.length*n):null,reasons};
};
const windows=x=>{
  const result=[];let hidden;
  for(const event of x.visibilityEvents??[]){
    if(!event.trusted)continue;
    if(event.state==='hidden')hidden=event.at;
    else if(hidden!==undefined){
      const before=x.timeline.filter(t=>t.at<event.at&&t.visible==='hidden').at(-1);
      const after=x.timeline.filter(t=>t.at>=event.at&&t.visible==='visible');
      const fresh=t=>t.coverage&&t.wallAt-t.coverage.at<=2000;
      const snapshot=after.find(t=>t.worker&&!t.failure&&t.streamOpen&&fresh(t)&&t.coverage.snapshotFresh>0);
      const eligible=after.find(t=>t.worker&&!t.failure&&t.streamOpen&&fresh(t)&&t.coverage.eligible>0);
      result.push({hiddenAt:hidden,visibleAt:event.at,durationMs:event.at-hidden,priorSession:before?.service?.sessionId,
        recoveredSession:snapshot?.service?.sessionId,firstFreshSnapshotMs:snapshot?snapshot.at-event.at:null,
        firstEligibleMs:eligible?eligible.at-event.at:null,framesBefore:before?.streamFrames,framesAfter:after.at(-1)?.streamFrames});hidden=undefined;
    }
  }return result;
};
const summarize=x=>({name:x.name,startedAt:x.startedAt,durationMs:x.durationMs,frames:x.frameCount,quotes:x.quotes,
  handlers:x.handlers,quoteLatency:x.quoteLatency,jitter:x.jitter,cpuSeconds:x.cpuSeconds,
  processCpuSeconds:x.processCpuSeconds?{delta:x.processCpuSeconds.delta,
    exitedPids:x.processCpuSeconds.start.filter(p=>!x.processCpuSeconds.end.some(q=>p.id===q.id)).map(p=>p.id)}:undefined,
  workerAlive:x.report?.worker,failure:x.report?.failure??null,wsCreated:x.wsCreated,wsClosed:x.wsClosed,
  workerCreated:x.workerCreated,workerTerminated:x.workerTerminated,
  subscriptions:x.sends.filter(s=>s.data!=='PING').map(s=>({at:s.at,sha256:hash(s.data),assets:JSON.parse(s.data).assets_ids?.length})),
  coverage:coverage(x.timeline,x.shadowAssets),after60s:coverage(x.timeline.filter(t=>t.at>60000),x.shadowAssets),
  hiddenCoverage:coverage(x.timeline.filter(t=>t.visible==='hidden'),x.shadowAssets),
  nativeWindows:windows(x),maxSampleGapMs:Math.max(0,...x.timeline.slice(1).map((t,i)=>t.at-x.timeline[i].at)),
  invalidationCount:x.invalidationCount,recordedInvalidations:x.invalidations?.length,
  unscopedInvalidations:x.invalidations?.filter(e=>e.assets===null).length,
  scopedInvalidations:count(x.invalidations?.filter(e=>e.assets!==null)??[],e=>e.assets.join(',')),
  probeOutcomes:count(x.probes??[],p=>p.outcome),workerCounters:x.report?.workerCounters,mailbox:x.report?.mailbox,
  differenceSamples:(x.probes??[]).filter(p=>p.outcome==='aligned_difference'),
  failedObservations:x.timeline.filter(t=>t.failure||t.worker===false).length,
  maxLongTaskMs:Math.max(0,...x.longTasks.map(t=>t.ms)),longTaskCount:x.longTasks.length});
const normalReplay=replay.filter(x=>x.name!=='replay-overflow');
const sourceFiles=['packages/venue-adapter/polymarket/realtime/ws.ts','packages/venue-adapter/polymarket/realtime/orderBook/service.ts',
  'packages/venue-adapter/polymarket/realtime/orderedWorkerMailbox.ts','packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/shadowWorkerClient.ts'];
const workerHash=hash(readAdapterHistory(live[0].workerUrl.slice(1)));
const prolongedWindows=[live[0],live[2]].flatMap(windows).filter(w=>w.durationMs>=300000);
const checks={
  sameCurrentWorker:[...live.filter(x=>x.report),...replay,controlled,lifecycle].every(x=>x.workerUrl===live[0].workerUrl),
  fixedCandidates:hash(readAdapterHistory(`${base}/candidates.json`))===hash(readAdapterHistory(`${base}/candidates-start.json`)),
  coldAndLateFifteenMinutes:live[0].durationMs>=900000&&live[2].durationMs>=900000,
  workersSurvived:[live[0],live[2]].every(x=>x.report?.worker&&!x.report.failure&&x.workerTerminated===0&&x.timeline.every(t=>!t.failure&&t.worker!==false)),
  // Cold observations include automation-interrupted native hidden windows. Keep
  // those, but require TWO uninterrupted >=5min windows in the final evidence.
  // Report their phases; never label fragmented hidden time as continuous.
  realHidden:native.source.hidden===true&&native.front.hidden===false&&prolongedWindows.length>=2
    &&prolongedWindows.every(w=>w.priorSession===w.recoveredSession&&w.framesAfter>w.framesBefore),
  recoveredFreshBooks:prolongedWindows.length>=2&&prolongedWindows.every(w=>w.firstFreshSnapshotMs!==null&&w.firstEligibleMs!==null),
  noExtraLateConnection:live[2].wsCreated===0&&live[2].wsClosed===0&&live[2].sends.filter(s=>s.data!=='PING').length===0,
  sameOriginalSubscriptions:new Set(live.flatMap(x=>x.sends.filter(s=>s.data!=='PING').map(s=>hash(s.data)))).size===1,
  assetFaultIsolation:controlled.checks.length>=20&&controlled.checks.every(c=>c.pass),
  sameReplayQuotes:normalReplay.length===4&&normalReplay.every(x=>x.quotes.completeHash&&x.quotes.count>100)
    &&new Set(normalReplay.map(x=>`${x.quotes.count}:${x.quotes.sha256}`)).size===1,
  quoteP95NoRegression:Math.max(...normalReplay.filter(x=>x.name.startsWith('replay-on')).map(x=>x.handlers.p95))
    <=Math.max(...normalReplay.filter(x=>x.name.startsWith('replay-off')).map(x=>x.handlers.p95)),
  noAlignedDifference:[live[0],live[2],lifecycle].every(x=>!x.report?.workerCounters?.aligned_difference&&!(x.probes??[]).some(p=>p.outcome==='aligned_difference')),
  consumerDetachKeepsOwner:lifecycle.marks.some(m=>m.label==='consumer-detached-owner-alive'&&m.service.worker&&m.service.diagnostics===0),
  detachedDepthAdvanced:lifecycle.depthBefore?.sessionId===lifecycle.depthAfter?.sessionId&&lifecycle.depthAfter?.status==='ready'&&lifecycle.depthAfter?.revision>lifecycle.depthBefore?.revision,
  reconnectRecovered:lifecycle.marks.some(m=>m.label==='recovered'&&m.report?.streamOpen&&m.report?.worker&&!m.report?.failure&&m.report?.coverage?.snapshotFresh>0),
  classicHttpGates:gates.results.length===12&&gates.results.every(r=>r.pass),
  resourcesReleased:resource.runs.length===3&&resource.runs.every(r=>r.settled===20&&r.workerCreated===20&&r.workerTerminated===20)
    &&resource.snapshots.every(s=>s.workers===0),
  freshFollowupEvidence:[...normalReplay,lifecycle].every(x=>Date.parse(x.startedAt)>liveEnd)
    &&[controlled,gates].every(x=>Date.parse(x.at)>liveEnd)&&resource.snapshots.every(s=>Date.parse(s.at)>liveEnd),
  defaultsAndHttpRemain:[live[0],live[2]].every(x=>x.report.activeSupported===false&&x.report.executionSource==='existing-http')
    &&gates.results.filter(r=>r.name.includes('HTTP identity')).length===4&&gates.results.filter(r=>r.name.includes('HTTP identity')).every(r=>r.details.identity&&r.details.calls===1),
};
const result={at:new Date().toISOString(),verdict:'REQUIRES_REVIEW_OF_COST_AND_COVERAGE',deploymentAuthorized:false,
  checks,blockers:Object.entries(checks).filter(([,pass])=>!pass).map(([name])=>name),browser:live[0].browser,
  workerUrl:live[0].workerUrl,workerSha256:workerHash,sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,hash(readAdapterHistory(f))])),
  candidatesSha256:hash(readAdapterHistory(`${base}/candidates.json`)),sourceAssets:recording.assets.length,watchedAssets:recording.watched.length,
  previousRetired:{durationMs:read('previous-retired/live-cold').durationMs,quotes:read('previous-retired/live-cold').quotes,
    health:count(read('previous-candidate-health').rows,r=>String(r.status??'error'))},
  live:live.map(summarize),replay:replay.map(summarize),assetIsolation:controlled,lifecycle:summarize(lifecycle),gates,
  resource,limits:['single native Chrome profile and local fixture, not full logged-in production app or 24h',
    'coverage is fixed asset-observations, not time weighted or fill rate; hidden sampling is throttled',
    'retired prior cohort is separate; current live cohort never replaces failed assets',
    'controlled synthetic asset faults prove browser Worker isolation, not live fault incidence',
    'aligned_difference counter includes both sample recording and invalidation; use distinct probe samples for discrepancy incidence',
    'ABBA is paced same-message replay; raw process CPU deltas require no exited PID to compare',
    'page GC heap excludes Worker heap; Worker target release separately checked',
    'HTTP is authoritative; no signer, order submission or active fast path tested',
    'no new 160-attempt source simulation: this audit measures fixed snapshot coverage, actual HTTP identity gates and behavioral regressions, not candidate hit rate']};
if(result.blockers.length)result.verdict='NO_GO';
fs.writeFileSync(`${base}/summary.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({checks,blockers:result.blockers,live:result.live.map(x=>({name:x.name,frames:x.frames,coverage:x.after60s,native:x.nativeWindows}))},null,2));
assert.equal(result.blockers.length,0,'browser evidence blockers; preserve failures and resolve before conclusion');
