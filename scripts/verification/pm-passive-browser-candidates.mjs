// Read-only discovery using the same public esports listing as the business collector.
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchPolymarketEsportsMarkets } from '../../server/collectors/polymarket-esports/api.js';
const out = process.argv.includes('--isolation') ? 'output/playwright/pm-asset-isolation' : process.argv.includes('--execution') ? 'output/pm-execution-simulation' : process.argv.includes('--mailbox') ? 'output/pm-mailbox-repair' : process.argv.includes('--refactor') ? 'output/pm-shared-book-refactor' : process.argv.includes('--repair') ? 'output/pm-passive-browser-repair' : 'output/pm-passive-browser';
const result = await fetchPolymarketEsportsMarkets();
let rows = result.markets.filter(m => m.closed !== true && m.archived !== true && m.acceptingOrders !== false
  && ['moneyline', 'child_moneyline'].includes(m.sportsMarketType))
  .map(m => ({ id: m.id, conditionId: m.conditionId, question: m.question, volume24hr: Number(m.volume24hr || 0),
    liquidity: Number(m.liquidity || 0), start: m.gameStartTime,
    tokens: typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds }))
  .filter(m => Array.isArray(m.tokens) && m.tokens.length).sort((a, b) => b.volume24hr - a.volume24hr);
if (process.argv.includes('--refactor') || process.argv.includes('--mailbox') || process.argv.includes('--execution')) {
  const health = [];
  for (const row of rows.slice(0, 64)) {
    let valid = true;
    for (const asset of row.tokens) {
      try {
        const r = await fetch(`https://clob.polymarket.com/book?token_id=${asset}`, { signal: AbortSignal.timeout(6000) });
        const body = r.ok ? await r.json() : null;
        const ok = r.ok && body?.asks?.length > 0 && body?.bids?.length > 0;
        health.push({ asset, status: r.status, valid: ok }); if (!ok) valid = false;
      } catch { health.push({ asset, valid: false }); valid = false; }
    }
    row.verified = valid;
    if (rows.filter(x => x.verified).length >= 8) break;
  }
  rows.sort((a, b) => Number(!!b.verified) - Number(!!a.verified));
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/candidate-health-start.json`, JSON.stringify({ at: new Date().toISOString(), health }, null, 2));
}
await mkdir(out, { recursive: true });
await writeFile(`${out}/candidates.json`, JSON.stringify({ at: new Date().toISOString(),
  rawEvents: result.rawEventCount, rawMarkets: result.rawMarketCount, rows }, null, 2));
console.log(JSON.stringify({ markets: rows.length, tokens: new Set(rows.flatMap(r => r.tokens)).size }));
