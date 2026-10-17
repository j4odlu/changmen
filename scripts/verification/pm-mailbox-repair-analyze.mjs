// [changmen 扩展] Read-only evidence summary. Checks cannot enable production or change limits.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'output/pm-mailbox-repair/';
const read = async name => JSON.parse(await readFile(`${root}${name}.json`, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const live = await Promise.all(['live-cold', 'live-off', 'live-late'].map(read));
const replay = await read('replay-summary'), lifecycle = await read('lifecycle'), gates = await read('browser-gates');
const control = await read('scheduler-control'), stress = await read('scheduler-control-stall'), native = await read('native-hidden-start');
const resources = await read('resource-heap');
const liveEnd = Date.parse(live[2].startedAt) + live[2].durationMs;
if (live[0].durationMs < 900000 || live[2].durationMs < 900000 || Date.parse(replay[0].startedAt) < liveEnd
  || Date.parse(lifecycle.startedAt) < liveEnd || Date.parse(gates.at) < liveEnd) throw Error('Incomplete or stale evidence');
function coverage(rows, n) {
  let snapshot = 0, eligible = 0, missing = 0, stale = 0;
  const misses = {};
  for (const row of rows) {
    if (!row.worker || row.failure || !row.coverage) { missing++; continue; }
    if (row.wallAt - row.coverage.at > 2000) { stale++; continue; }
    snapshot += row.coverage.snapshotFresh; eligible += row.coverage.eligible;
    for (const [key, count] of Object.entries(row.coverage.misses)) misses[key] = (misses[key] ?? 0) + count;
  }
  return { samples: rows.length, assetObservations: rows.length * n, snapshot, eligible, missing, stale,
    snapshotRatio: rows.length ? snapshot / (rows.length * n) : null, eligibleRatio: rows.length ? eligible / (rows.length * n) : null, misses };
}
function nativeWindows(x) {
  const result = []; let hidden;
  for (const event of x.visibilityEvents ?? []) {
    if (!event.trusted) continue;
    if (event.state === 'hidden') hidden = event.at;
    else if (hidden !== undefined) {
      const prior = x.timeline.filter(t => t.at < event.at && t.visible === 'hidden').at(-1);
      const after = x.timeline.filter(t => t.at >= event.at && t.visible === 'visible');
      const fresh = t => (t.wallAt ?? Date.parse(x.startedAt) + t.at) - (t.coverage?.at ?? 0) <= 2000;
      const ready = after.find(t => t.worker && t.streamOpen && !t.failure && fresh(t) && t.coverage?.snapshotFresh > 0);
      const eligible = after.find(t => t.worker && t.streamOpen && !t.failure && fresh(t) && t.coverage?.eligible > 0);
      result.push({ hiddenAt: hidden, visibleAt: event.at, durationMs: event.at - hidden,
        priorSession: prior?.service?.sessionId, recoveredSession: ready?.service?.sessionId,
        firstFreshSnapshotMs: ready ? ready.at - event.at : null, firstEligibleMs: eligible ? eligible.at - event.at : null,
        recoveredStreamEpoch: ready?.streamEpoch, priorStreamEpoch: prior?.streamEpoch,
        incrementBefore: prior?.counters?.increment_state_received, incrementAfter: after.at(-1)?.counters?.increment_state_received });
      hidden = undefined;
    }
  }
  return result;
}
function summary(x) {
  const outcomes = {};
  for (const p of x.probes ?? []) outcomes[p.outcome] = (outcomes[p.outcome] ?? 0) + 1;
  const rows = x.timeline.map(t => ({ ...t, wallAt: t.wallAt ?? Date.parse(x.startedAt) + t.at }));
  return { name: x.name, startedAt: x.startedAt, durationMs: x.durationMs, frames: x.frameCount, quotes: x.quotes,
    handlers: x.handlers, quoteLatency: x.quoteLatency, jitter: x.jitter, cpuSeconds: x.cpuSeconds,
    wsCreated: x.wsCreated, wsClosed: x.wsClosed, workerCreated: x.workerCreated, workerTerminated: x.workerTerminated,
    workerAlive: x.report?.worker, failure: x.report?.failure ?? null, mailbox: x.report?.mailbox,
    workerCounters: x.report?.workerCounters, mainCounters: x.report?.counters,
    subscriptionMessages: x.sends.filter(s => s.data !== 'PING').map(s => ({ at: s.at, sha256: hash(s.data), assets: JSON.parse(s.data).assets_ids?.length })),
    coverage: coverage(rows, x.shadowAssets), after60s: coverage(rows.filter(t => t.at > 60000), x.shadowAssets),
    hiddenCoverage: coverage(rows.filter(t => t.visible === 'hidden'), x.shadowAssets),
    visibleCoverage: coverage(rows.filter(t => t.visible === 'visible'), x.shadowAssets),
    maxSampleGapMs: Math.max(0, ...rows.slice(1).map((t,i) => t.at - rows[i].at)),
    visibilityEvents: x.visibilityEvents, nativeWindows: nativeWindows(x), probeOutcomes: outcomes,
    firstFailure: rows.find(t => t.failure), depthBefore: x.depthBefore, depthAfter: x.depthAfter,
    marks: x.marks?.map(m => ({ label:m.label, at:m.at, worker:m.service?.worker, diagnostics:m.service?.diagnostics, sessionId:m.service?.sessionId })) };
}
const windows = live.flatMap(nativeWindows);
const prolongedWindows = windows.filter(w=>w.durationMs>=300000);
const active = live.filter(x => x.name !== 'live-off');
const off = replay.filter(x => x.name.startsWith('replay-off')), on = replay.filter(x => x.name.startsWith('replay-on'));
const result = { at: new Date().toISOString(), verdict: 'REQUIRES_AUDIT', deploymentAuthorized: false,
  worker: { url: live[0].workerUrl, sha256: hash(await readFile(`client/web/dist/assets/${live[0].workerUrl.split('/').at(-1)}`)) },
  mailboxSourceSha256: hash(await readFile('packages/venue-adapter/polymarket/realtime/orderedWorkerMailbox.ts')),
  browser: live[0].browser, native, live: live.map(summary), replay: replay.map(summary), lifecycle: summary(lifecycle), gates, resources,
  schedulerControl: { durationMs: control.durationMs, counts: control.counts, orderErrors: control.orderErrors,
    oldFailure: control.oldFailure, currentFailure: control.currentFailure, hiddenSamples: control.timeline.filter(t => t.state === 'hidden').length,
    currentMailbox: control.timeline.at(-1)?.current, visibilityEvents: control.visibilityEvents, scope: control.scope },
  schedulerStress: { durationMs: stress.durationMs, counts: stress.counts, orderErrors: stress.orderErrors,
    oldFailure: stress.oldFailure, currentFailure: stress.currentFailure, stalls: stress.stalls,
    currentMailbox: stress.timeline.at(-1)?.current, hiddenSamples: stress.timeline.filter(t=>t.state==='hidden').length, scope: stress.scope },
  checks: {
    liveThirtyMinutes: active.every(x=>x.durationMs>=900000),
    workersSurvived: active.every(x=>x.report?.worker && !x.report.failure && x.workerTerminated===0),
    nativeHidden: native.source.hidden===true && native.cover.visibility==='visible' && windows.some(w=>w.durationMs>=300000),
    foregroundRecovery: prolongedWindows.length>=2 && prolongedWindows.every(w=>w.firstFreshSnapshotMs!==null && w.priorSession===w.recoveredSession && w.incrementAfter>w.incrementBefore),
    oldSchedulerReproduced: stress.oldFailure?.reason==='stream_ack_timeout' && stress.stalls.length===1 && stress.timeline.some(t=>t.state==='hidden'),
    newSchedulerControlPassed: [control,stress].every(x=>!x.currentFailure && x.counts.current>1000 && x.orderErrors.current===0),
    quoteSequenceIdentical: [...off,...on].every(x=>x.quotes.completeHash && x.quotes.count>100) && new Set([...off,...on].map(x=>`${x.quotes.count}:${x.quotes.sha256}`)).size===1,
    quoteP95NoRegression: Math.max(...on.map(x=>x.handlers.p95)) <= Math.max(...off.map(x=>x.handlers.p95)),
    gatesPass: gates.results.length===12 && gates.results.every(x=>x.pass),
    currentCandidatesValid: gates.publicBookHealth.length===16 && gates.publicBookHealth.every(x=>x.status===200 && x.validBook),
    noAlignedDifference: [...active,lifecycle].every(x=>!x.report?.workerCounters?.aligned_difference && !(x.probes??[]).some(p=>p.outcome==='aligned_difference') && !x.timeline.some(t=>t.counters?.aligned_difference)),
    consumerIndependent: lifecycle.depthAfter?.status==='ready' && lifecycle.depthAfter?.revision>lifecycle.depthBefore?.revision && lifecycle.depthBefore?.sessionId===lifecycle.depthAfter?.sessionId,
    resourcesReleased: resources.runs.length===3 && resources.runs.every(r=>r.requested===20 && r.settled===20 && r.workerCreated===20 && r.workerTerminated===20) && resources.snapshots.every(s=>s.workers===0),
    nativeSubscriptionsUnchanged: new Set(active.flatMap(x=>x.sends.filter(s=>s.data!=='PING').map(s=>hash(s.data)))).size===1,
  },
  limits: ['Public-market fixture, not a logged-in river production session; no orders or fill-rate evidence.',
    'Native hidden timers are sparse: coverage is sample observations, not a time-weighted continuous percentage.',
    'Original PM-M may reconnect in hidden/foreground transitions; no new network authority in the book module.',
    'Scheduler echo control overlaps live run, including one recorded 250ms control-renderer stall; replay and lifecycle follow soak. No full-build/test load overlaps soak.',
    'Replay keeps recorded timestamps; it checks original quote output and main-thread transport costs, not fresh-book eligibility or live Worker reduction cost.',
    'CPU metrics, when available, measure page tasks/scripts and exclude Worker CPU; they are not whole-browser CPU.'] };
result.blockers = Object.entries(result.checks).filter(([,pass])=>!pass).map(([key])=>key);
result.verdict = result.blockers.length ? 'NO_GO' : 'ELIGIBLE_FOR_LIMITED_SHADOW_REVIEW';
await writeFile(`${root}mailbox-summary.json`, JSON.stringify(result,null,2));
console.log(JSON.stringify({checks:result.checks,blockers:result.blockers,live:result.live.map(x=>({name:x.name,frames:x.frames,mailbox:x.mailbox,windows:x.nativeWindows,coverage:x.after60s})),control:result.schedulerControl},null,2));
