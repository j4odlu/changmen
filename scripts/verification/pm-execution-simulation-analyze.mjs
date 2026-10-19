import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// Public/synthetic evidence only. Passing this analysis never authorizes active execution or release.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const base = process.argv.includes('--availability') ? 'output/pm-book-availability' : 'output/pm-execution-simulation';
const read = withAdapterHistoryReader(name => JSON.parse(readAdapterHistory(`${base}/${name}.json`, 'utf8')));
const controlled = read('execution-browser-controlled'), live = read('execution-browser-live'), gates = read('browser-gates');
const count = (rows, key) => rows.reduce((out, row) => { const value = key(row); out[value] = (out[value] ?? 0) + 1; return out; }, {});
const latency = (rows, key) => {
  const values = rows.map(key).filter(Number.isFinite).sort((a, b) => a - b);
  const p = n => values.length ? values[Math.ceil(n * values.length) - 1] : null;
  return { count: values.length, p50: p(.5), p95: p(.95), max: values.at(-1) ?? null };
};
const samples = live.report.samples.filter(row => row.source === 'attempt');
const checks = {
  controlledComplete: controlled.rows.length === 200 && controlled.rows.every(r => r.levels === 100 && r.decision === 'local_candidate'),
  disconnectRecovery: controlled.disconnected !== 'ready' && controlled.beforeSnapshot === 'waiting_snapshot' && controlled.recovered === 'ready',
  released: controlled.final.worker === false && controlled.final.pendingReads === 0 && controlled.final.consumers === 0,
  completeDenominator: live.attempts.length === 160 && samples.length === 160 && samples.every(row => row.simulation),
  httpOnce: live.attempts.every(row => row.calls === 1),
  httpSuccessIdentity: live.attempts.filter(row => !row.error).every(row => row.identity === true),
  httpFailuresObserved: live.attempts.filter(row => row.error).length === samples.filter(row => row.httpFailed).length,
  bothDecisions: samples.some(row => row.simulation?.decision === 'local_candidate') && samples.some(row => row.simulation?.decision === 'http_fallback'),
  noComparableDifference: samples.every(row => row.simulationComparison !== 'aligned_difference') && !live.report.simulation.failure,
  // A running feed can have in-flight messages at the instant of sampling. Check
  // the unchanged bounds; stopped-resource cleanup is verified separately above.
  liveWorkerHealthy: live.service.worker === true && !live.service.failure
    && live.service.mailbox.pendingEntries <= 2048 && live.service.mailbox.pendingChars <= 2_000_000
    && live.service.mailbox.oldestQueuedMs <= 1000 && live.service.mailbox.oldestInflightMs <= 1000,
  oneOriginalConnection: live.created === 1 && live.closed === 0,
  classicAndHttpGates: gates.results.length === 12 && gates.results.every(row => row.pass),
  latestGates: Date.parse(gates.at) >= Date.parse(live.at),
};
const subscriptions = live.sends.filter(row => row !== 'PING');
const report = {
  at: live.at, scope: live.scope, checks,
  controlled: { cases: controlled.rows.length, levels: 100, latencyMs: latency(controlled.rows, row => row.totalMs) },
  live: { durationMs: live.durationMs, frames: live.service.streamFrames, quotes: live.quotes,
    sourceConnections: live.created, sourceCloses: live.closed, subscriptionMessages: subscriptions.length,
    subscriptionSha256: createHash('sha256').update(JSON.stringify(subscriptions)).digest('hex'),
    attempts: samples.length, httpRequests: live.attempts.reduce((n, row) => n + row.calls, 0),
    httpSucceeded: live.attempts.filter(row => !row.error).length, httpFailed: live.attempts.filter(row => row.error).length,
    decisions: count(samples, row => row.simulation?.decision ?? 'missing'), reasons: count(samples, row => row.simulation?.reason ?? 'missing'),
    comparisons: count(samples, row => row.simulationComparison ?? 'not_candidate'),
    localLatencyMs: latency(samples.filter(row => row.simulation?.decision === 'local_candidate'), row => row.simulation.totalMs),
    httpLatencyMs: latency(samples, row => row.httpMs), mailbox: live.service.mailbox,
    fullReads: live.service.fullReads, workerCounters: live.report.workerCounters },
  browser: live.browser, workerUrl: live.workerUrl,
  limits: ['synthetic attempts, not user execution or fills', 'headless foreground; no new native-background or 24-hour evidence',
    'HTTP remains authoritative; fallback simulation reuses the same HTTP observation, not a second network request',
    'local timing includes full read and math, not signing/order/paired-fill latency',
    'exact same-input 10000-case math regression is synthetic, not 10000 live comparable books'],
  verdict: 'SHADOW_SIMULATION_ONLY_NOT_ACTIVE_READY', deploymentAuthorized: false,
};
fs.writeFileSync(`${base}/summary.json`, JSON.stringify(report, null, 2) + '\n');
for (const [name, passed] of Object.entries(checks)) assert(passed, name);
console.log(JSON.stringify(report, null, 2));
