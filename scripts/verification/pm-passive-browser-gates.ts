import { setPmFokPreflightMode } from '../../packages/venue-adapter/polymarket/pmFokPreflightMode';
import { runPmBuyPreflight } from '../../packages/venue-adapter/polymarket/submission/preflight/pmBuyPreflight';
import { registerWsBookShadowObserver } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/shadowObserver';
import { setPmRoutingPreference } from '../../packages/venue-adapter/polymarket/pmRoutingPreference';
import { user } from './pm-passive-browser-gate-fixture';
import { parseHttpBook } from '../../packages/venue-adapter/polymarket/submission/preflight/optimized/wsBook/bookMetadata';
// Local server serves the unchanged gate body with explicit fixture imports.
const gateUrl = '/verification-gate-controller.js';
const { installPmDynamicWsPreflight, stopPmDynamicWsPreflight } = await import(/* @vite-ignore */ gateUrl);
const button = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector('#result')!;
const pause = () => new Promise(r => setTimeout(r, 250));
button.onclick = async () => {
  button.disabled = true;
  const NativeWorker = window.Worker, NativeSocket = window.WebSocket;
  let created = 0, terminated = 0, sockets = 0;
  window.Worker = class extends NativeWorker { constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); created++; } terminate() { terminated++; super.terminate(); } };
  window.WebSocket = class extends NativeSocket { constructor(...args: ConstructorParameters<typeof WebSocket>) { super(...args); sockets++; } };
  const results: any[] = [];
  const check = (name: string, condition: boolean, details: unknown) => { results.push({ name, pass: condition, details }); if (!condition) throw new Error(name); };
  try {
    setPmRoutingPreference('official');
    for (const mode of ['legacy', undefined, 'invalid']) {
      localStorage.setItem('changmen:pm:local-book', '1'); setPmFokPreflightMode(mode); installPmDynamicWsPreflight(); await pause();
      check(`classic gate ${mode}`, created === 0 && sockets === 0, { created, sockets }); stopPmDynamicWsPreflight();
    }
    localStorage.removeItem('changmen:pm:local-book'); setPmFokPreflightMode('optimized'); installPmDynamicWsPreflight(); await pause();
    check('optimized defaults off', created === 0, { created }); stopPmDynamicWsPreflight();
    localStorage.setItem('changmen:pm:local-book', '1'); installPmDynamicWsPreflight(); await pause();
    check('explicit dynamic starts isolated worker', created === 1 && sockets === 0, { created, sockets });
    setPmFokPreflightMode('legacy'); check('classic switch synchronously terminates', terminated === 1, { terminated });
    setPmFokPreflightMode('optimized'); setPmFokPreflightMode('legacy'); await pause();
    check('late import cannot restart classic', created === 1, { created });
    user.isLoggedIn = false; setPmFokPreflightMode('optimized'); await pause();
    check('logout prevents start', created === 1, { created }); stopPmDynamicWsPreflight();
    const discovered = (await (await fetch('/verification-candidates.json')).json()).rows;
    // [changmen 扩展] Identity checks need one currently existing HTTP book. This
    // choice never changes the fixed live cohort or its coverage denominator.
    const identityCandidates: any[] = [];
    let candidate: any;
    for (const row of discovered.slice(0, 8)) {
      const response = await fetch(`https://clob.polymarket.com/book?token_id=${row.tokens[0]}`, { credentials: 'omit', signal: AbortSignal.timeout(5000) });
      identityCandidates.push({ asset: row.tokens[0], status: response.status });
      if (response.ok) { candidate = row; break; }
    }
    if (!candidate) throw Error('No existing public book for HTTP identity gate; keep failed evidence');
    const option = { type: 'Polymarket', target: 'Home', itemId: candidate.tokens[0], betId: candidate.conditionId,
      bet: { round: 0 }, match: { providers: {}, pmSport: { live: true, updatedAt: Date.now() } } };
    const account = { provider: 'Polymarket', gateway: 'https://clob.polymarket.com', token: '', accountId: 0 };
    for (const mode of ['legacy', 'optimized'] as const) for (const throws of [false, true]) {
      let observed = 0, calls = 0;
      const release = registerWsBookShadowObserver(() => { observed++; if (throws) throw new Error('observer failure fixture'); return () => {}; });
      let http: any;
      const result = await runPmBuyPreflight(account as any, option as any, { sportMode: mode, role: 'precheckOnly', gateway: account.gateway,
        runtimeBinding: () => '', missingCredentialsMessage: 'unused', market: async () => {
          calls++; const response = await fetch(`https://clob.polymarket.com/book?token_id=${candidate.tokens[0]}`, { credentials: 'omit' });
          if (!response.ok) throw new Error(`public book HTTP ${response.status}`);
          const body = await response.json(); http = { price: Number(body.asks.at(-1)?.price), orderOptions: { asks: body.asks.map((x: any) => ({ price: +x.price, size: +x.size })), bookTimestamp: +body.timestamp } }; return http;
        } });
      release(); check(`${mode} HTTP identity observerThrows=${throws}`, calls === 1 && result.market.status === 'fulfilled' && result.market.value === http && observed === (mode === 'legacy' ? 0 : 1),
        { calls, observed, status: result.market.status, identity: result.market.status === 'fulfilled' && result.market.value === http, guard: result.guard });
    }
    const publicBookHealth: any[] = [];
    for (const asset of [...new Set<string>(discovered.slice(0, 64).flatMap((row: any) => row.tokens))].slice(0, 16)) {
      const item: any = { asset }; publicBookHealth.push(item);
      try {
        const response = await fetch(`https://clob.polymarket.com/book?token_id=${asset}`, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
        item.status = response.status;
        if (response.ok) {
          const body = await response.json(); item.asks = body.asks?.length; item.bids = body.bids?.length;
          try { const parsed = parseHttpBook(body, asset, performance.now()); item.validBook = !!parsed.book; item.metadata = !!parsed.metadata; }
          catch (error) { item.validationError = String(error); }
        }
      } catch (error) { item.requestError = String(error); }
    }
    const evidence = { at: new Date().toISOString(), browser: navigator.userAgent, scope: 'gate with explicit store/consumer fixtures; actual precheckOnly entry with public HTTP; no signer or order', identityCandidates, results, publicBookHealth };
    await fetch('/verification-evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'browser-gates', value: evidence }) });
    output.textContent = JSON.stringify(evidence, null, 2);
  } catch (error) { output.textContent = JSON.stringify({ error: String(error), results }, null, 2); }
  finally { stopPmDynamicWsPreflight(); setPmFokPreflightMode('legacy'); localStorage.removeItem('changmen:pm:local-book'); window.Worker = NativeWorker; window.WebSocket = NativeSocket; button.disabled = false; }
};
