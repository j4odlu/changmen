import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// Compare fixed-denominator observation periods. This is NOT a randomized fill-rate experiment.
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = withAdapterHistoryReader(p => JSON.parse(readAdapterHistory(p, 'utf8')));
const base = 'output/pm-book-availability';
const old = read('output/pm-execution-simulation/summary.json');
const next = read(`${base}/summary.json`), live = read(`${base}/execution-browser-live.json`);
const hash = withAdapterHistoryReader(p => createHash('sha256').update(readAdapterHistory(p)).digest('hex'));
assert.equal(hash(`${base}/candidates.json`), hash('output/pm-execution-simulation/candidates.json'));
assert.equal(next.live.attempts, 160); assert.equal(old.live.attempts, 160);
assert.equal(next.live.subscriptionSha256, old.live.subscriptionSha256);
assert(Object.values(next.checks).every(Boolean));
assert.equal(live.observations.length, 160);
const coverage = live.observations.filter(row => row.coverage).map(row => row.coverage);
const sum = field => coverage.reduce((n, r) => n + r[field], 0);
const totalAssets = sum('assets');
const recovery = read(`${base}/execution-browser-network-recovery.json`);
const priorSamples = recovery.report.samples.filter(row => row.source === 'attempt');
const allSamples = [...priorSamples, ...live.report.samples.filter(row => row.source === 'attempt')];
const count = (rows, key) => rows.reduce((out, row) => { const value = key(row); out[value] = (out[value] ?? 0) + 1; return out; }, {});
assert.equal(priorSamples.length, 160);
assert(recovery.attempts.every(row => row.calls === 1 && (row.error || row.identity)));
assert(priorSamples.every(row => row.simulation && row.simulationComparison !== 'aligned_difference'));
const result = {
  at: next.at, candidateSha256: hash(`${base}/candidates.json`),
  checks: next.checks, controlled: next.controlled,
  worker: { url: next.workerUrl, sha256: hash(next.workerUrl.slice(1)) },
  previous: old.live, current: next.live,
  candidateRate: { previous: old.live.decisions.local_candidate / 160, current: next.live.decisions.local_candidate / 160 },
  networkRecovery: { at: recovery.at, durationMs: recovery.durationMs, attempts: priorSamples.length,
    connections: recovery.created, closes: recovery.closed, frames: recovery.service.streamFrames, quotes: recovery.quotes,
    decisions: count(priorSamples, row => row.simulation.decision), reasons: count(priorSamples, row => row.simulation.reason),
    comparisons: count(priorSamples, row => row.simulationComparison ?? 'not_candidate'),
    httpSucceeded: recovery.attempts.filter(row => !row.error).length, httpFailed: recovery.attempts.filter(row => row.error).length,
    fullReads: recovery.service.fullReads, workerCounters: recovery.report.workerCounters, mailbox: recovery.service.mailbox },
  allRuns: { attempts: allSamples.length, decisions: count(allSamples, row => row.simulation.decision),
    reasons: count(allSamples, row => row.simulation.reason), comparisons: count(allSamples, row => row.simulationComparison ?? 'not_candidate'),
    candidateRate: allSamples.filter(row => row.simulation.decision === 'local_candidate').length / allSamples.length },
  observations: { samples: coverage.length, totalAssets, snapshotFresh: sum('snapshotFresh'), eligible: sum('eligible'),
    snapshotCoverage: totalAssets ? sum('snapshotFresh') / totalAssets : null,
    eligibility: totalAssets ? sum('eligible') / totalAssets : null,
    metadataPresence: live.observations.reduce((n, r) => n + r.metadataInMemory, 0) / (160 * 16) },
  limits: [...next.limits, 'same fixed assets, different live periods: observed rate change is not a causal A/B estimate',
    'recovered full reads are catch-up successes, not necessarily successful execution simulation candidates'],
  verdict: 'BOUNDED_SHADOW_ONLY_ACTIVE_NO_GO', deploymentAuthorized: false,
};
fs.writeFileSync(`${base}/availability.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
