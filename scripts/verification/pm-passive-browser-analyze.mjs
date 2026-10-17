import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'output/pm-passive-browser/';
const read = async name => JSON.parse(await readFile(`${root}${name}.json`, 'utf8'));
const live = await Promise.all(['live-cold', 'live-off', 'live-late'].map(read));
const replay = await read('replay-summary');
const recording = await read('recording');
const gates = await read('browser-gates');
const counts = new Map(), seconds = new Map(); let books = 0, deltas = 0, chars = 0, maxFrame = 0;
for (const frame of recording.frames) {
  chars += frame.raw.length; maxFrame = Math.max(maxFrame, frame.raw.length);
  const second = Math.floor((frame.at - recording.frames[0].at) / 1000);
  seconds.set(second, (seconds.get(second) || 0) + 1);
  const value = JSON.parse(frame.raw);
  for (const event of Array.isArray(value) ? value : [value]) {
    if (event.event_type === 'book') { books++; counts.set(event.asset_id, (counts.get(event.asset_id) || 0) + 1); }
    if (event.event_type === 'price_change') deltas++;
  }
}
function summary(x) {
  const outcomes = {}, misses = {};
  for (const s of x.samples) { outcomes[s.outcome] = (outcomes[s.outcome] || 0) + 1; if (s.miss) misses[s.miss] = (misses[s.miss] || 0) + 1; }
  const subscriptions = x.sends.filter(s => s.data !== 'PING').map(s => { const m = JSON.parse(s.data); return { at: s.at, assets: m.assets_ids?.length, initialDump: m.initial_dump,
    sha256: createHash('sha256').update(s.data).digest('hex') }; });
  return { name: x.name, startedAt: x.startedAt, durationMs: x.durationMs, frames: x.frameCount, chars: x.chars,
    framesPerSecond: x.frameCount / (x.durationMs / 1000), quotes: x.quotes, handlerMs: x.handlers, quoteCallbackLatencyMs: x.quoteLatency,
    timerJitterMs: x.jitter, wsCreated: x.wsCreated, wsClosedDuringPhase: x.wsClosed, workerCreated: x.workerCreated, workerTerminated: x.workerTerminated,
    subscriptions, pings: x.sends.filter(s => s.data === 'PING').length, failure: x.report?.failure,
    firstFailureSampleMs: x.timeline.find(t => t.failure)?.at, maxReportedSnapshots: Math.max(0, ...x.timeline.map(t => t.snapshots ?? 0)),
    allSamplesVisible: x.timeline.every(t => t.visible === 'visible'), syntheticReads: x.samples.length, syntheticOutcomes: outcomes, syntheticMisses: misses,
    readySyntheticReads: x.samples.filter(s => s.epoch !== undefined && !s.miss && s.outcome === 'http_shape_unknown').length,
    counters: x.report?.counters, workerCounters: x.report?.workerCounters,
    executionSource: x.report?.executionSource, activeSupported: x.report?.activeSupported };
}
const worker = await readFile(`client/web/dist/assets/${live[0].workerUrl.split('/').at(-1)}`);
const result = { at: new Date().toISOString(), verdict: 'NO_GO_PRODUCTION_SHADOW', browser: live[0].browser,
  workerUrl: live[0].workerUrl, workerSha256: createHash('sha256').update(worker).digest('hex'),
  scope: { publicEsports: true, applicationSourceModules: true, productionWorker: true, fullLoggedInApp: false,
    realOrderSubmission: false, sourceAssets: recording.assets.length, shadowAssets: recording.watched.length,
    gateFixtures: true, coverageReadsAreSynthetic: true, HTTPPrecheckOnlyChecksAreReal: true },
  live: live.map(summary), replay: replay.map(summary), gates,
  rawCapture: { frames: recording.frames.length, spanMs: recording.frames.at(-1).at - recording.frames[0].at,
    chars, boundedAtChars: 20_000_000, maxFrameChars: maxFrame, maxFramesOneSecond: Math.max(...seconds.values()),
    fullBookEvents: books, bookAssets: counts.size, watchedBookAssets: recording.watched.filter(id => counts.has(id)).length,
    priceChangeEvents: deltas, watchedBookCounts: recording.watched.map(id => counts.get(id) || 0),
    sha256: createHash('sha256').update(await readFile(`${root}recording.json`)).digest('hex') },
  limitations: [ 'Live on phases failed early; their aggregate performance is mostly shadow disabled.',
    'Paced replay preserves raw messages/order, changes arrival pacing, and does not prove live freshness or fill rate.',
    'Synthetic reads are not HTTP attempts; do not use their http_resolved or timing as production HTTP metrics.',
    'Long-task export arrays can include measurement serialization; no live long-task or memory conclusion is drawn.',
    'Gate source body is unchanged; user store and consumer bootstrapping are explicit fixtures, not river login.',
    'Single foreground Brave browser on one machine; no background, low-end-device, or live order claim.' ] };
await writeFile('docs/audits/pm-passive-book-browser-20261016.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ verdict: result.verdict, live: result.live.map(x => ({ name: x.name, frames: x.frames, failure: x.failure, ready: x.readySyntheticReads, reads: x.syntheticReads })),
  quotesEqual: new Set(result.replay.filter(x => x.name !== 'replay-overflow').map(x => x.quotes.sha256)).size === 1,
  gates: gates.results.every(x => x.pass), rawCapture: result.rawCapture }, null, 2));
