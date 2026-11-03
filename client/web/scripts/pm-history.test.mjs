import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/aaaa298/pm-history.js';
const H = globalThis.PMHistory;
const observation = (timestamp, price, resolution_seconds = 60) => ({ timestamp, price, resolution_seconds });

test('market history excludes settlement and invalid prices; sorts and retains zero prices', () => {
  assert.deepEqual(H.normalize([observation(120, 0), observation(60, .45), observation(180, 1, 0), observation(190, null), observation(200, 2)]), [
    { timestamp: 60, price: .45, resolution: 60 }, { timestamp: 120, price: 0, resolution: 60 }
  ]);
});
test('cursor never reads a future price or carries a stale quote across a gap', () => {
  const rows = H.normalize([observation(60, .4), observation(120, .8), observation(1000, .7)]);
  assert.equal(H.atOrBefore(rows, 59), null);
  assert.equal(H.atOrBefore(rows, 119).price, .4);
  assert.equal(H.atOrBefore(rows, 120).price, .8);
  assert.equal(H.atOrBefore(rows, 500), null);
  assert.deepEqual(H.segments(rows, 60, 1000).map(g => g.map(p => p.timestamp)), [[60, 120], [1000]]);
});
test('token mapping follows outcome indices and known opposite token, never 1 minus price', () => {
  const m = { id: 'condition', positions: [], activities: [{ token_id: 'away', outcome_index: 0 }] };
  assert.deepEqual(H.tokensFor(m, [
    { condition_id: 'condition', token_id: 'away', outcome_index: 0, opposite_token_id: 'home' },
    { condition_id: 'other', token_id: 'wrong', outcome_index: 1 },
  ]), ['away', 'home']);
});
test('history follows all pages; caches pending requests; independent side failures remain visible', async () => {
  const calls = [];
  const request = async (path, q) => {
    calls.push([path, q]);
    if (path === 'tokens') return { data: [
      { condition_id: 'c', token_id: 'A', outcome_index: 0 },
      { condition_id: 'c', token_id: 'B', outcome_index: 1 }
    ] };
    if (q.token_id === 'B') throw new Error('HTTP 429');
    return q.cursor ? { data: [observation(960, .6)], pagination: { next_cursor: null } }
      : { data: [observation(900, .5)], pagination: { has_more: true, next_cursor: 'next' } };
  };
  const loader = H.createLoader(request), now = Date.now();
  const m = { id: 'c', activities: [{ type: 'TRADE', timestamp: 1000 }], positions: [], open: false };
  const entry = loader.get(m, now);
  assert.equal(loader.get(m, now), entry);
  await entry.promise;
  assert.equal(entry.status, 'ready');
  assert.deepEqual(entry.sides[0].map(p => p.price), [.5, .6]);
  assert.equal(entry.errors[1], 'HTTP 429');
  assert.equal(loader.get(m), entry);
  assert.equal(calls.filter(([path]) => path === 'tokens').length, 1);
});
test('incomplete pagination does not pretend a partial history is complete', async () => {
  const loader = H.createLoader(async path => path === 'tokens' ? { data: [] }
    : { data: [observation(1000, .5)], pagination: { has_more: true, next_cursor: null } });
  const entry = loader.get({ id: 'c', positions: [], activities: [{ type: 'TRADE', timestamp: 1000, token_id: 'a', outcome_index: 0 }] });
  await entry.promise;
  assert.deepEqual(entry.sides[0], []);
  assert.match(entry.errors[0], /分页未完成/);
});
