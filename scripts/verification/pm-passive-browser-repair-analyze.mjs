// [changmen 扩展] Summarize repaired passive-feed evidence. Never enables a flag or authorizes deployment.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'output/pm-passive-browser-repair/';
const read = async name => JSON.parse(await readFile(`${root}${name}.json`, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const live = await Promise.all(['live-cold', 'live-off', 'live-late'].map(read));
const replay = await read('replay-summary'), gates = await read('browser-gates'), lifecycle = await read('lifecycle'), background = await read('background');
const liveEnd = Date.parse(live[2].startedAt) + live[2].durationMs;
if (live[0].durationMs < 900_000 || live[2].durationMs < 900_000
  || Date.parse(replay[0]?.startedAt) < liveEnd || Date.parse(lifecycle.startedAt) < liveEnd || Date.parse(gates.at) < liveEnd)
  throw new Error('Incomplete soak or stale follow-up evidence; do not mix preliminary runs into final results');
function coverage(rows, requested) {
  const reasons = {}; let denominator = 0, snapshots = 0, eligible = 0, absent = 0, staleReports = 0;
  for (const row of rows) {
    // Include missing and >2s-old reports as zero; do not select only successful observations.
    denominator += requested;
    if (!row.coverage || !row.worker || row.failure) { absent++; continue; }
    const age = row.wallAt == null ? 0 : row.wallAt - row.coverage.at;
    if (age > 2000) { staleReports++; continue; }
    snapshots += row.coverage.snapshotFresh; eligible += row.coverage.eligible;
    for (const [key, n] of Object.entries(row.coverage.misses)) reasons[key] = (reasons[key] ?? 0) + n;
  }
  return { observations: rows.length, requestedAssetObservations: denominator, snapshotFreshAssetObservations: snapshots,
    eligibleAssetObservations: eligible, snapshotRatio: denominator ? snapshots / denominator : null,
    eligibleRatio: denominator ? eligible / denominator : null, missingReportObservations: absent, staleReports, reasons };
}
function summary(x) {
  const outcomes = {}, misses = {};
  for (const sample of x.samples) { outcomes[sample.outcome] = (outcomes[sample.outcome] ?? 0) + 1;
    if (sample.miss) misses[sample.miss] = (misses[sample.miss] ?? 0) + 1; }
  const ready = x.samples.filter(s => s.epoch !== undefined && !s.miss && s.outcome === 'http_shape_unknown').length;
  const pending = x.samples.filter(s => s.outcome === 'comparison_pending').length;
  const timeline = x.timeline.map(t => ({ ...t, wallAt: Date.parse(x.startedAt) + t.at }));
  const timing = field => {
    const values = x.samples.map(s => s[field]).filter(Number.isFinite).sort((a,b) => a-b);
    return { count: values.length, p50: values[Math.ceil(values.length * .5)-1] ?? null, p95: values[Math.ceil(values.length * .95)-1] ?? null };
  };
  return { name: x.name, startedAt: x.startedAt, durationMs: x.durationMs, frames: x.frameCount, chars: x.chars,
    quotes: x.quotes, handlerMs: x.handlers, quoteLatencyMs: x.quoteLatency, timerJitterMs: x.jitter,
    wsCreated: x.wsCreated, wsClosed: x.wsClosed, workerCreated: x.workerCreated, workerTerminated: x.workerTerminated,
    subscriptions: x.sends.filter(s => s.data !== 'PING').map(s => ({ at: s.at, hash: hash(s.data), assets: JSON.parse(s.data).assets_ids?.length })),
    failure: x.report?.failure ?? null, workerAliveAtEnd: x.report?.worker ?? null,
    workerFailedObservations: timeline.filter(t => t.worker === false || t.failure).length,
    visibleObservations: timeline.filter(t => t.visible === 'visible').length, hiddenObservations: timeline.filter(t => t.visible === 'hidden').length,
    coverage: coverage(timeline, x.shadowAssets), after60s: coverage(timeline.filter(t => t.at > 60_000), x.shadowAssets),
    syntheticReads: { recorded: x.samples.length, ready, pending, outcomes, misses },
    syntheticBeginQueueMs: timing('beginQueueMs'), syntheticFinishQueueMs: timing('observerQueueMs'),
    counters: x.report?.counters, workerCounters: x.report?.workerCounters, mailbox: x.report?.mailbox,
    marks: x.marks?.map(m => ({ label: m.label, at: m.at, worker: m.report?.worker, failure: m.report?.failure,
      epoch: m.report?.streamEpoch, open: m.report?.streamOpen, assets: m.report?.assets, coverage: m.report?.coverage })) };
}
const worker = await readFile(`client/web/dist/assets/${live[0].workerUrl.split('/').at(-1)}`);
const result = { at: new Date().toISOString(), verdict: 'REQUIRES_HUMAN_AUDIT_CONCLUSION', deploymentAuthorized: false,
  browser: live[0].browser, workerUrl: live[0].workerUrl, workerSha256: hash(worker),
  live: live.map(summary), replay: replay.map(summary), lifecycle: summary(lifecycle), background: summary(background), gates,
  checks: {
    liveThirtyMinutes: live.filter(x => x.name !== 'live-off').reduce((n,x) => n + x.durationMs, 0) >= 1_800_000,
    liveWorkersSurvived: live.filter(x => x.name !== 'live-off').every(x => x.report?.worker && !x.report.failure && x.workerTerminated === 0),
    sameReplayQuotes: replay.filter(x => x.name !== 'replay-overflow').every(x => x.quotes.completeHash)
      && new Set(replay.filter(x => x.name !== 'replay-overflow').map(x => `${x.quotes.count}:${x.quotes.sha256}`)).size === 1,
    gatesPass: gates.results.length === 12 && gates.results.every(x => x.pass),
    noAlignedDifference: [...live, lifecycle].every(x => !x.report?.workerCounters?.aligned_difference),
    backgroundActuallyHidden: background.timeline.some(t => t.visible === 'hidden'),
    backgroundWorkerSurvived: background.report?.worker === true && !background.report?.failure,
  },
  limits: ['Fixed prior-discovered 118 source tokens / 16 candidates; discovery refresh failed, not river production portfolio.',
    'Live quote hashes cover only first 10000 outputs; only replay hashes are complete.',
    'Diagnostic reads are synthetic, public probes and precheckOnly checks do not submit orders.',
    'Coverage is sampled asset-observations, not exact time integration or production fill rate.',
    'One Brave browser/device; fixture uses actual source modules and built Worker, not full logged-in app.',
    'Bounded raw recording may skip oversized-to-remaining-budget frames; only initial replay prefix used.',
    'Lifecycle intentionally closes its fixture-owned connection; recovery uses original PM-M implementation.'] };
await writeFile(`${root}repair-summary.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ checks: result.checks, live: result.live.map(x => ({ name: x.name, frames: x.frames,
  failure: x.failure, coverage: x.after60s, reads: x.syntheticReads, mailbox: x.mailbox })), lifecycle: result.lifecycle.marks }, null, 2));
