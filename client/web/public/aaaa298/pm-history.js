/* PM public history overlay helpers. No account credentials or order operations. */
(function (root) {
  'use strict';
  function normalize(rows) {
    const byTime = new Map();
    for (const row of rows) {
      const t = Number(row.timestamp), p = Number(row.price), resolution = Number(row.resolution_seconds);
      // Resolution 0 is a settlement payout, not a market-price observation.
      if (row.price == null || !Number.isFinite(t) || !Number.isFinite(p) || p < 0 || p > 1 || !(resolution > 0)) continue;
      byTime.set(t, { timestamp: t, price: p, resolution });
    }
    return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  }
  function atOrBefore(rows, timestamp) {
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid].timestamp <= timestamp) lo = mid + 1; else hi = mid; }
    const p = rows[lo - 1];
    return p && timestamp - p.timestamp <= Math.max(120, p.resolution * 2) ? p : null;
  }
  function segments(rows, first, last) {
    const result = []; let previous;
    for (const p of rows) {
      if (p.timestamp < first || p.timestamp > last) continue;
      if (!previous || p.timestamp - previous.timestamp > Math.max(previous.resolution, p.resolution) * 3) result.push([]);
      result.at(-1).push(p); previous = p;
    }
    return result;
  }
  function tokensFor(m, metadata) {
    const known = [new Set(), new Set()];
    for (const r of [...m.activities, ...m.positions]) {
      if (r.token_id && [0, 1].includes(r.outcome_index)) known[r.outcome_index].add(String(r.token_id));
    }
    const rows = metadata.filter(r => String(r.condition_id).toLowerCase() === m.id.toLowerCase());
    const tokens = known.map(set => set.size === 1 ? [...set][0] : null);
    for (let i = 0; i < 2; i++) {
      if (tokens[i]) continue;
      const opposite = rows.find(r => String(r.token_id) === tokens[1 - i] && Number(r.outcome_index) === 1 - i)?.opposite_token_id;
      const choices = [...new Set(rows.filter(r => Number(r.outcome_index) === i).map(r => String(r.token_id)))];
      tokens[i] = opposite ? String(opposite) : choices.length === 1 ? choices[0] : null;
    }
    return tokens;
  }
  function createLoader(request) {
    const cache = new Map();
    async function history(token, start, end) {
      const rows = [];
      // The API caps explicit time windows at 15 days. Retain all pages in each window.
      for (let from = start; from < end; from += 14 * 86400) {
        const until = Math.min(end, from + 14 * 86400), seen = new Set(); let cursor;
        do {
          const page = await request('prices-history', { token_id: token, start: from, end: until, limit: 10000, cursor });
          if (!Array.isArray(page.data) || !page.pagination) throw new Error('行情响应格式异常');
          rows.push(...page.data);
          const next = page.pagination.next_cursor;
          if (page.pagination.has_more && !next) throw new Error('行情分页未完成');
          if (next && seen.has(next)) throw new Error('行情分页游标重复');
          if (next) seen.add(next);
          cursor = next;
        } while (cursor);
      }
      return normalize(rows).filter(p => p.timestamp >= start && p.timestamp < end);
    }
    function get(m, now = Date.now()) {
      const trades = m.activities.filter(r => r.type === 'TRADE' && Number.isFinite(Number(r.timestamp)));
      if (!trades.length) return { status: 'empty', sides: [[], []], errors: ['没有成交时间范围'] };
      const start = Math.min(...trades.map(r => Number(r.timestamp))) - 600;
      const last = Math.max(...trades.map(r => Number(r.timestamp)));
      const live = m.open && now / 1000 - last < 86400;
      const end = Math.min(Math.floor(now / 1000), live ? Math.ceil(now / 60000) * 60 : last + 600);
      const signature = JSON.stringify([start, live ? 'live' : end, m.activities.filter(r => r.token_id).map(r => [r.outcome_index, r.token_id]).sort().filter((r, i, a) => !i || String(r) !== String(a[i - 1]))]);
      let entry = cache.get(m.id);
      const ttl = entry?.errors.some(Boolean) ? 60000 : live ? 60000 : 3600000;
      if (entry && entry.signature === signature && (entry.status === 'loading' || now - entry.checkedAt < ttl)) return entry;
      entry = { signature, status: 'loading', sides: [[], []], errors: [], checkedAt: now, start, end };
      cache.set(m.id, entry);
      entry.promise = (async () => {
        let metadata = [], lookupError;
        try { const d = await request('tokens', { condition: m.id }); metadata = d.data || []; }
        catch (e) { lookupError = e.message; }
        const tokens = tokensFor(m, metadata);
        await Promise.all(tokens.map(async (token, i) => {
          if (!token) { entry.errors[i] = lookupError || '未能唯一确认本方 token'; return; }
          try { entry.sides[i] = await history(token, start, end); }
          catch (e) { entry.errors[i] = e.message; }
        }));
        entry.status = 'ready'; entry.checkedAt = Date.now();
        return entry;
      })();
      return entry;
    }
    return { get };
  }
  root.PMHistory = { normalize, atOrBefore, segments, tokensFor, createLoader };
})(globalThis);
