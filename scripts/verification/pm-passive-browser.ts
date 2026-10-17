// [changmen 扩展] Browser-only measurement fixture; not imported by the application.
import { registerPolymarketQuoteAssets, onPolymarketMarketQuote, stopPolymarketMarketQuoteHub } from '../../packages/venue-adapter/polymarket/quotes/marketQuoteHub';
import { setPmMarketWsSourceMode } from '../../packages/venue-adapter/polymarket/pmMarketWsMode';
import { setPmRoutingPreference } from '../../packages/venue-adapter/polymarket/pmRoutingPreference';
import { resetPolymarketLiveQuoteTsForTests } from '../../packages/venue-adapter/polymarket/pmTokenQuote';
import { PmOrderBookService } from '../../packages/venue-adapter/polymarket/realtime/orderBook/service';
import { WsBookShadowWorkerClient } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/shadowWorkerClient';
import { beginWsBookShadow } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/shadowObserver';

const status = document.querySelector('#status')!;
const nativeWs = window.WebSocket, nativeWorker = window.Worker;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const save = async (name: string, value: unknown) => {
  const r = await fetch('/verification-evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, value }) });
  if (!r.ok) throw new Error(`evidence ${r.status}`);
};
const candidates = await (await fetch('/verification-candidates.json')).json();
const workerUrl = (await (await fetch('/verification-worker.json')).json()).url;
const outputBase = (await (await fetch('/verification-worker.json')).json()).outputBase;
const liveMs = Math.max(90, Math.min(1800, Number(new URLSearchParams(location.search).get('seconds')) || 90)) * 1000;
document.querySelector('#live')!.textContent = `实时验证：冷接入 ${liveMs / 1000}s / 关闭 15s / 晚接入 ${liveMs / 1000}s`;
const marketRows = candidates.rows.slice(0, 64);
const assets: string[] = [...new Set<string>(marketRows.flatMap((r: any) => r.tokens))];
const watched = assets.slice(0, 16);
let service: PmOrderBookService | undefined;
let shadow: WsBookShadowWorkerClient | undefined, stopped = false, running = false;
let frames: Array<{ raw: string; at: number }> = [], frameChars = 0, recording = false;
let metrics: any, phase = '', phaseStarted = 0, receivedAt = 0;
let measuredSocket: MeasuredSocket | undefined;
const all: any[] = [];
class Histogram {
  n = 0; max = 0; bins = new Map<number, number>();
  push(value: number) { const bin = Math.round(value * 100); this.n++; this.max = Math.max(this.max, value); this.bins.set(bin, (this.bins.get(bin) ?? 0) + 1); }
  summary() { const rows = [...this.bins].sort((a, b) => a[0] - b[0]);
    const percentile = (p: number) => { let n = 0; for (const [bin, count] of rows) { n += count; if (n >= Math.ceil(this.n * p)) return bin / 100; } return null; };
    return { n: this.n, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: this.max, resolutionMs: .01 }; }
}
function resetMetrics(name: string) {
  phase = name; phaseStarted = performance.now();
  metrics = { name, startedAt: new Date().toISOString(), wsCreated: 0, wsClosed: 0, workerCreated: 0, workerTerminated: 0,
    sends: [], frameCount: 0, chars: 0, handlers: new Histogram(), quoteLatency: new Histogram(), quotes: [], quoteCount: 0,
    longTasks: [], jitter: new Histogram(), timeline: [], visibilityEvents: [], invalidations: [], invalidationCount: 0, samples: new Map(), probes: new Map() };
  metrics.cpuStart = (window as any).__verificationCpuSnapshot?.();
}
document.addEventListener('visibilitychange', event => {
  if (metrics) metrics.visibilityEvents.push({ at: performance.now() - phaseStarted, state: document.visibilityState, trusted: event.isTrusted });
});
function received(raw: string) {
  receivedAt = performance.now(); metrics.frameCount++; metrics.chars += raw.length;
  if (recording && raw !== 'PONG' && frameChars + raw.length <= 20_000_000) { frames.push({ raw, at: receivedAt }); frameChars += raw.length; }
}
class MeasuredSocket extends nativeWs {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols); metrics.wsCreated++; measuredSocket = this;
    const desc = Object.getOwnPropertyDescriptor(nativeWs.prototype, 'onmessage')!;
    Object.defineProperty(this, 'onmessage', { configurable: true, get: () => desc.get!.call(this), set: fn => desc.set!.call(this, fn && ((event: MessageEvent) => {
      received(String(event.data)); const at = performance.now(); try { fn.call(this, event); } finally { metrics.handlers.push(performance.now() - at); }
    })) });
    this.addEventListener('close', () => metrics.wsClosed++);
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) { metrics.sends.push({ at: performance.now() - phaseStarted, data: String(data) }); super.send(data); }
}
let fakeSocket: ReplaySocket | undefined;
class ReplaySocket {
  static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
  readyState = 0; onmessage?: (e: MessageEvent) => void; onopen?: () => void; onclose?: () => void; onerror?: () => void;
  constructor() { fakeSocket = this; metrics.wsCreated++; setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0); }
  send(data: string) { metrics.sends.push({ at: performance.now() - phaseStarted, data }); }
  close() { this.readyState = 3; metrics.wsClosed++; this.onclose?.(); }
  push(raw: string) { received(raw); const at = performance.now(); this.onmessage?.({ data: raw } as MessageEvent); metrics.handlers.push(performance.now() - at); }
}
function startShadow() {
  service = new PmOrderBookService(() => !stopped, () => {
    metrics.workerCreated++;
    const w = new nativeWorker(workerUrl, { type: 'module', name: 'pm-passive-browser-production' });
    // [changmen 扩展] Bounded observation only; never changes source or Worker messages.
    w.addEventListener('message', event => {
      if (event.data?.type === 'book_invalidated') {
        metrics.invalidationCount++;
        if (metrics.invalidations.length < 2048) metrics.invalidations.push({ at: performance.now() - phaseStarted, assets: event.data.assets ?? null });
      }
    });
    const terminate = w.terminate.bind(w); w.terminate = () => { metrics.workerTerminated++; terminate(); };
    return w;
  });
  shadow = new WsBookShadowWorkerClient(() => !stopped, service);
  shadow.setAssets(watched);
}
function stopShadow() { shadow?.stop(); shadow = undefined; service?.stop(); service = undefined; }
const unquote = onPolymarketMarketQuote(q => { metrics.quoteCount++; if (metrics.quotes.length < 10000) metrics.quotes.push([q.assetId, q.bestAsk]); metrics.quoteLatency.push(performance.now() - receivedAt); });
const longTask = new PerformanceObserver(list => { if (metrics) for (const e of list.getEntries()) if (e.startTime >= phaseStarted && metrics.longTasks.length < 1000) metrics.longTasks.push({ start: e.startTime - phaseStarted, ms: e.duration }); });
try { longTask.observe({ type: 'longtask', buffered: false }); } catch { /* unavailable browser */ }
let lastBeat = performance.now();
const heartbeat = setInterval(() => { const now = performance.now(); if (metrics) metrics.jitter.push(Math.max(0, now - lastBeat - 20)); lastBeat = now; }, 20);
async function finishPhase() {
  const report = shadow?.report();
  const cpuStart = await metrics.cpuStart, cpuEnd = await (window as any).__verificationCpuSnapshot?.();
  const cpuSeconds = cpuStart && cpuEnd ? Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']
    .map(key => [key, cpuEnd[key] - cpuStart[key]])) : undefined;
  const processCpuSeconds = cpuStart?.ProcessCpuSeconds !== undefined && cpuEnd?.ProcessCpuSeconds !== undefined
    ? { delta: cpuEnd.ProcessCpuSeconds - cpuStart.ProcessCpuSeconds, start: cpuStart.Processes, end: cpuEnd.Processes } : undefined;
  const quoteText = JSON.stringify(metrics.quotes);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(quoteText)))].map(x => x.toString(16).padStart(2, '0')).join('');
  const result = JSON.parse(JSON.stringify({ ...metrics, samples: [...metrics.samples.values()], probes: [...metrics.probes.values()],
    durationMs: performance.now() - phaseStarted, quotes: { count: metrics.quoteCount, hashedCount: metrics.quotes.length, completeHash: metrics.quoteCount === metrics.quotes.length, sha256: digest },
    handlers: metrics.handlers.summary(), quoteLatency: metrics.quoteLatency.summary(), jitter: metrics.jitter.summary(),
    browser: navigator.userAgent, visibility: document.visibilityState, workerUrl, sourceAssets: assets.length, shadowAssets: watched.length, report, cpuSeconds, processCpuSeconds }));
  all.push(result); await save(phase, result); return result;
}
function sample() {
  const r = shadow?.report();
  metrics.timeline.push({ at: performance.now() - phaseStarted, wallAt: Date.now(), visible: document.visibilityState, service: service?.report(), worker: r?.worker, failure: r?.failure,
    streamOpen: r?.streamOpen, streamEpoch: r?.streamEpoch, assets: r?.assets, streamFrames: service?.report().streamFrames,
    snapshots: r?.snapshotsInMemory, metadata: r?.metadataInMemory, pending: r?.pendingStream, counters: r?.workerCounters, coverage: r?.coverage, mailbox: r?.mailbox });
  if (r) for (const s of r.samples) {
    if (s.source === 'attempt') metrics.samples.set(s.observerId, s);
    else metrics.probes.set(`${s.at}:${s.tokenId}`, s);
  }
  status.textContent = JSON.stringify({ phase, seconds: Math.round((performance.now() - phaseStarted) / 1000), frames: metrics.frameCount,
    quotes: metrics.quoteCount, worker: r?.worker, failure: r?.failure, assets: r?.assets, snapshots: r?.snapshotsInMemory, metadata: r?.metadataInMemory, coverage: r?.coverage, mailbox: r?.mailbox }, null, 2);
}
// Synthetic diagnostic reads measure miss/age only; they are NOT actual HTTP preflights or fill attempts.
function diagnosticReads() {
  if (!shadow) return;
  for (const tokenId of watched) beginWsBookShadow({ tokenId, gateway: 'https://clob.polymarket.com', tick: false, proxied: false, role: 'precheckOnly', leg: 'coverage' })(undefined, false);
}
async function observeFor(ms: number) {
  const end = performance.now() + ms; let tick = 0;
  while (!stopped && performance.now() < end) {
    await sleep(1000); sample(); if (++tick % 2 === 0) diagnosticReads();
    if (tick % 30 === 0) await save(`${phase}-checkpoint`, { at: new Date().toISOString(), seconds: (performance.now() - phaseStarted) / 1000,
      frames: metrics.frameCount, quotes: metrics.quoteCount, handlers: metrics.handlers.summary(), report: shadow?.report(), latest: metrics.timeline.at(-1) });
  }
  await sleep(100); sample();
}
async function live() {
  if (running) return; running = true; stopped = false; frames = []; frameChars = 0;
  try {
    setPmRoutingPreference('official'); setPmMarketWsSourceMode('official');
    resetMetrics('live-cold'); window.WebSocket = MeasuredSocket; recording = true;
    startShadow(); registerPolymarketQuoteAssets('esport', assets);
    await observeFor(liveMs); await finishPhase(); stopShadow();
    if (!stopped) { resetMetrics('live-off'); await observeFor(15_000); await finishPhase(); }
    if (!stopped) { resetMetrics('live-late'); startShadow(); await observeFor(liveMs); await finishPhase(); stopShadow(); }
    recording = false; stopPolymarketMarketQuoteHub(); window.WebSocket = nativeWs;
    await save('recording', { candidatesAt: candidates.at, rows: marketRows, assets, watched, frames });
    await save('live-summary', all.filter(x => x.name.startsWith('live')));
    status.textContent = '实时验证完成；结果已写入 output/pm-passive-browser。可继续同消息回放。';
  } catch (error) { status.textContent = String(error); await save('live-error', { error: String(error) }); }
  finally { recording = false; stopShadow(); stopPolymarketMarketQuoteHub(); window.WebSocket = nativeWs; running = false; }
}
async function replay() {
  if (running) return; running = true; stopped = false;
  try {
    if (!frames.length) frames = (await (await fetch(`${outputBase}/recording.json`)).json()).frames;
    if (!frames.length) throw new Error('No live frames recorded');
    const input = frames.slice(0, 3000);
    for (const [name, enabled] of [['replay-off-1', false], ['replay-on-1', true], ['replay-on-2', true], ['replay-off-2', false]] as const) {
      if (stopped) break;
      resetMetrics(name); resetPolymarketLiveQuoteTsForTests(); window.WebSocket = ReplaySocket as any;
      if (enabled) startShadow(); registerPolymarketQuoteAssets('esport', assets); await sleep(250);
      for (let i = 0; i < input.length && !stopped; i++) { fakeSocket!.push(input[i]!.raw); if (i % 4 === 3) await sleep(8); }
      await sleep(1200); sample(); await finishPhase(); stopShadow(); stopPolymarketMarketQuoteHub();
    }
    if (!stopped) {
      resetMetrics('replay-overflow'); resetPolymarketLiveQuoteTsForTests(); window.WebSocket = ReplaySocket as any;
      startShadow(); registerPolymarketQuoteAssets('esport', assets); await sleep(250);
      for (const frame of input.slice(0, 100)) fakeSocket!.push(frame.raw);
      await sleep(1200); sample(); await finishPhase(); stopShadow(); stopPolymarketMarketQuoteHub();
    }
    await save('replay-summary', all.filter(x => x.name.startsWith('replay')));
    status.textContent = '回放和故障验证完成；结果已保存。';
  } catch (error) { status.textContent = String(error); await save('replay-error', { error: String(error) }); }
  finally { stopShadow(); stopPolymarketMarketQuoteHub(); window.WebSocket = nativeWs; running = false; }
}
async function lifecycle() {
  if (running) return; running = true; stopped = false;
  try {
    setPmRoutingPreference('official'); setPmMarketWsSourceMode('official');
    resetMetrics('lifecycle'); metrics.marks = []; window.WebSocket = MeasuredSocket;
    const mark = (label: string) => metrics.marks.push({ label, at: performance.now() - phaseStarted, report: shadow?.report(), service: service?.report() });
    startShadow(); registerPolymarketQuoteAssets('esport', assets);
    await observeFor(30_000); mark('initial');
    // Only consumer selection changes; the original PM-M subscription stays identical.
    shadow?.setAssets(watched.slice(0, 8)); await observeFor(10_000); mark('eight-candidates');
    shadow?.setAssets(watched); await observeFor(10_000); mark('sixteen-restored');
    const depth = service!.acquire(); depth.setInterests(watched.slice(0, 1));
    metrics.depthBefore = await depth.readDepth(watched[0]!);
    shadow?.stop(); shadow = undefined; mark('consumer-detached-owner-alive');
    await observeFor(10_000); metrics.depthAfter = await depth.readDepth(watched[0]!); depth.release();
    shadow = new WsBookShadowWorkerClient(() => !stopped, service!); shadow.setAssets(watched); mark('consumer-reattached');
    // Fault injection into this fixture-owned source only. Its existing reconnect code owns recovery.
    if (!stopped) { measuredSocket?.close(1000, 'verification-only-disconnect'); mark('source-close-requested'); }
    await observeFor(60_000); mark('recovered'); await finishPhase();
    status.textContent = '候选切换及原连接恢复验证完成；证据已保存。';
  } catch (error) { status.textContent = String(error); await save('lifecycle-error', { error: String(error) }); }
  finally { stopShadow(); stopPolymarketMarketQuoteHub(); window.WebSocket = nativeWs; running = false; }
}
async function background() {
  if (running) return; running = true; stopped = false;
  // Switch native tabs externally: no focus/visibility emulation, no synthetic hidden events.
  try {
    setPmRoutingPreference('official'); setPmMarketWsSourceMode('official');
    resetMetrics('background'); window.WebSocket = MeasuredSocket;
    startShadow(); registerPolymarketQuoteAssets('esport', assets);
    await observeFor(480_000); await finishPhase();
    status.textContent = '后台验证完成；请以记录中的 visible/hidden 状态确认有效样本。';
  } catch (error) { status.textContent = String(error); await save('background-error', { error: String(error) }); }
  finally { stopShadow(); stopPolymarketMarketQuoteHub(); window.WebSocket = nativeWs; running = false; }
}
document.querySelector('#live')!.addEventListener('click', () => void live());
document.querySelector('#replay')!.addEventListener('click', () => void replay());
document.querySelector('#lifecycle')!.addEventListener('click', () => void lifecycle());
document.querySelector('#background')!.addEventListener('click', () => void background());
// Local test-only hook for retained-heap and resource-release checks, after the live run.
(window as any).__pmVerificationResourceCycles = async (count = 20) => {
  if (running) throw Error('Finish the current phase first');
  running = true; stopped = false;
  let settled = 0;
  try {
    if (!frames.length) frames = (await (await fetch(`${outputBase}/recording.json`)).json()).frames;
    resetMetrics('resources'); resetPolymarketLiveQuoteTsForTests(); window.WebSocket = ReplaySocket as any;
    registerPolymarketQuoteAssets('esport', assets); await sleep(250);
    for (let i = 0; i < Math.min(40, count); i++) {
      startShadow(); const depth = service!.acquire(); depth.setInterests(watched.slice(0, 1));
      for (const frame of frames.slice(0, 64)) fakeSocket!.push(frame.raw);
      const read = depth.readDepth(watched[0]!); await sleep(25);
      shadow?.stop(); shadow = undefined; depth.release(); service?.stop(); service = undefined;
      await read; settled++; await sleep(25);
    }
    const result = { at: new Date().toISOString(), requested: count, settled, workerCreated: metrics.workerCreated, workerTerminated: metrics.workerTerminated,
      wsCreated: metrics.wsCreated, scope: 'Synthetic replay socket; repeated owner/consumer/depth leases; no orders, dynamic public probes retain their normal consumer lifecycle' };
    await save('resources', result); return result;
  } finally { stopShadow(); stopPolymarketMarketQuoteHub(); window.WebSocket = nativeWs; running = false; }
};
document.querySelector('#stop')!.addEventListener('click', () => { stopped = true; stopShadow(); stopPolymarketMarketQuoteHub(); });
window.addEventListener('beforeunload', () => { stopped = true; stopShadow(); stopPolymarketMarketQuoteHub(); unquote(); clearInterval(heartbeat); longTask.disconnect(); });
status.textContent = `就绪：${assets.length} 个原行情资产，${watched.length} 个旁路候选。默认未启动。Worker: ${workerUrl}`;
