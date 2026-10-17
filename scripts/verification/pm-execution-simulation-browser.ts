// Local-only browser harness. Explicit public data and precheckOnly, no login/signer/orders.
import { PmOrderBookService } from '../../packages/venue-adapter/polymarket/realtime/orderBook/service';
import { WsBookShadowWorkerClient } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/shadowWorkerClient';
import { simulateLocalSource } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/executionSimulation';
import { simulateExecutableBuy } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/executionMath';
import { parseHttpBook } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/bookMetadata';
import { runPmBuyPreflight } from '../../packages/venue-adapter/polymarket/submission/preflight/pmBuyPreflight';
import { registerPolymarketQuoteAssets, onPolymarketMarketQuote, stopPolymarketMarketQuoteHub } from '../../packages/venue-adapter/polymarket/quotes/marketQuoteHub';
import { setPmRoutingPreference } from '../../packages/venue-adapter/polymarket/pmRoutingPreference';
import { setPmMarketWsSourceMode } from '../../packages/venue-adapter/polymarket/pmMarketWsMode';
import type { MarketStreamEvent } from '../../packages/venue-adapter/polymarket/realtime/marketStreamProtocol';

const workerUrl = (await (await fetch('/verification-worker.json')).json()).url;
const status = document.querySelector('#status')!;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const save = async (name: string, value: unknown) => {
  const r = await fetch('/verification-evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, value }) });
  if (!r.ok) throw Error(`save ${r.status}`);
};
let running = false;
document.querySelector<HTMLButtonElement>('#controlled')!.onclick = async () => {
  if (running) return; running = true;
  let frame!: (event: MarketStreamEvent) => void;
  let sequence = 0, epoch = 1;
  const service = new PmOrderBookService(() => true, () => new Worker(workerUrl, { type: 'module' }), () => ['1'], fn => {
    frame = fn; fn({ type: 'state', state: { epoch, open: true, source: 'official' } }); return () => {};
  });
  const lease = service.acquire(); lease.setInterests(['1']);
  const input = { tokenId: '1', detectionOdds: 2, apiBetMoney: 5, maxPrice: .5, depth: { enabled: false, multiplier: 1.5 } };
  const rows: any[] = [];
  const snapshot = () => {
    const raw = { event_type: 'book', asset_id: '1', market: 'm', timestamp: String(Date.now()), hash: 'synthetic',
      version: 'v2', tick_size: '0.001', min_order_size: '1', neg_risk: false,
      asks: Array.from({ length: 100 }, (_, i) => ({ price: String((400 + i) / 1000), size: '100' })), bids: [] };
    frame({ type: 'frame', epoch, sequence: ++sequence, receivedAt: performance.timeOrigin + performance.now(), wallAt: Date.now(), raw: JSON.stringify(raw) });
    return raw;
  };
  try {
    await pause(300);
    for (let i = 0; i < 200; i++) {
      const raw = snapshot(); await pause(5);
      const full = await lease.readFullBook('1');
      const meta = parseHttpBook(raw, '1', performance.now()).metadata!;
      const observed = await simulateLocalSource(input, lease, { ...meta, asset: '1', clockAt: performance.timeOrigin + meta.at, bookGeneration: full.generation, assetGeneration: full.assetGeneration! }, () => true);
      rows.push({ case: i, levels: full.asks?.length, ...observed.report });
    }
    frame({ type: 'state', state: { epoch, open: false, source: 'official' } });
    const disconnected = await lease.readFullBook('1');
    epoch++; sequence = 0; frame({ type: 'state', state: { epoch, open: true, source: 'official' } }); await pause(20);
    const beforeSnapshot = await lease.readFullBook('1'); snapshot(); await pause(20);
    const recovered = await lease.readFullBook('1');
    lease.release(); const released = await lease.readFullBook('1'); service.stop();
    const evidence = { at: new Date().toISOString(), browser: navigator.userAgent, workerUrl, scope: 'synthetic full-book inputs, real browser production Worker; no network source, no orders',
      rows, disconnected: disconnected.status, beforeSnapshot: beforeSnapshot.status, recovered: recovered.status, released: released.status, final: service.report() };
    await save('execution-browser-controlled', evidence); status.textContent = JSON.stringify(evidence, null, 2);
  } catch (error) { status.textContent = String(error); }
  finally { service.stop(); running = false; }
};
document.querySelector<HTMLButtonElement>('#live')!.onclick = async () => {
  if (running) return; running = true;
  const discovered = (await (await fetch('/verification-candidates.json')).json()).rows;
  const assets = [...new Set<string>(discovered.flatMap((r: any) => r.tokens))].slice(0, 100), watched = assets.slice(0, 16);
  const NativeSocket = window.WebSocket;
  let created = 0, closed = 0, quotes = 0; const sends: string[] = [];
  window.WebSocket = class extends NativeSocket {
    constructor(...args: ConstructorParameters<typeof WebSocket>) { super(...args); created++; this.addEventListener('close', () => closed++); }
    send(data: Parameters<WebSocket['send']>[0]) { sends.push(String(data)); super.send(data); }
  };
  setPmRoutingPreference('official'); setPmMarketWsSourceMode('official');
  const unquote = onPolymarketMarketQuote(() => quotes++);
  registerPolymarketQuoteAssets('esport', assets);
  const service = new PmOrderBookService(() => true, () => new Worker(workerUrl, { type: 'module' }));
  const client = new WsBookShadowWorkerClient(() => true, service); client.setAssets(watched);
  const attempts: any[] = [], observations: any[] = [], started = performance.now();
  try {
    await pause(4000);
    for (let i = 0; i < 160; i++) {
      const tokenId = watched[i % watched.length]!;
      const input = { tokenId, detectionOdds: 1 / .99, apiBetMoney: 5, maxPrice: .99, depth: { enabled: false, multiplier: 1.5 } };
      const option = { type: 'Polymarket', target: 'Home', itemId: tokenId, betId: '', bet: { round: 0 }, match: { providers: {}, pmSport: { live: true, updatedAt: Date.now() } } };
      let calls = 0, value: any, error: any;
      try {
        const result = await runPmBuyPreflight({ provider: 'Polymarket', accountId: 0 } as any, option as any, {
          sportMode: 'optimized', role: 'precheckOnly', gateway: 'https://clob.polymarket.com', shadowInput: input,
          runtimeBinding: () => '', missingCredentialsMessage: 'unused', market: async () => {
            calls++; const r = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000) });
            if (!r.ok) throw Error(`HTTP ${r.status}`);
            const raw = await r.json(); const { book, metadata: meta } = parseHttpBook(raw, tokenId, performance.now());
            if (!meta) throw Error('metadata missing');
            const orderOptions = { version: meta.version, tickSize: meta.tick as any, minOrderSize: meta.minSize, negRisk: meta.negRisk,
              bookTimestamp: book.sourceAt, asks: [...book.asks].map(([price, size]) => ({ price: +price, size: +size })).sort((a, b) => a.price - b.price) };
            value = { ...simulateExecutableBuy(input, orderOptions), orderOptions, bookFetchedAt: Date.now() }; return value;
          } });
        attempts.push({ i, calls, identity: result.market.status === 'fulfilled' && result.market.value === value });
      } catch (e) { error = String(e); attempts.push({ i, calls, error }); }
      const observed = client.report();
      observations.push({ i, at: performance.now() - started, coverage: observed.coverage, metadataInMemory: observed.metadataInMemory,
        fullReads: service.report().fullReads });
      status.textContent = JSON.stringify({ i, calls, error, quotes, service: service.report(), simulation: observed.simulation }, null, 2);
      await pause(500);
    }
    await pause(1000);
    const report = client.report();
    const evidence = { at: new Date().toISOString(), browser: navigator.userAgent, workerUrl, durationMs: performance.now() - started,
      scope: '160 synthetic precheckOnly attempts on public live markets, real PM-M and HTTP; no accounts/signers/orders; HTTP calculator separately differential-tested',
      created, closed, quotes, sends, attempts, observations, report, service: service.report() };
    client.stop(); service.stop();
    await save('execution-browser-live', evidence); status.textContent = JSON.stringify(evidence, null, 2);
  } catch (error) { status.textContent = String(error); }
  finally { client.stop(); service.stop(); unquote(); stopPolymarketMarketQuoteHub(); window.WebSocket = NativeSocket; running = false; }
};
