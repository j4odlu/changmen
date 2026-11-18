import assert from "node:assert/strict";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";

// Real aggregation against an isolated local cluster; never loads application .env.
await withTemporaryPostgres(async () => {
  const { getPgPool } = await import("../../rds/pg_pool.js");
  const { fetchObSingleOrderAnalytics, fetchValueBetProfitAnalytics } = await import("../../rds/rds/orders_store.js");
  const { Currency, getExchange } = await import("@changmen/shared/currency");
  const pool = getPgPool();
  assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
  const start = new Date(2026, 10, 17).getTime(), end = new Date(2026, 10, 19).getTime();
  const ts = start + 3600000;
  const uid = "00000000-0000-4000-8000-000000000001";
  try {
    await pool.query(`CREATE TABLE profiles(id uuid PRIMARY KEY, user_name text);
      CREATE TABLE players(id bigint PRIMARY KEY, owner_user_id uuid, provider text, player_name text, account_data jsonb, deleted_at bigint);
      CREATE TABLE orders (
      id serial PRIMARY KEY, order_id text, user_id uuid, provider text, link bigint, create_at bigint,
      player_id bigint, odds float8, bet_money float8, money float8, status text, raw jsonb)`);
    let sequence = 0;
    async function insert(base, provider, status, bet, profit, raw = {}, timestamp = ts, sign = -1, userId = uid, playerId = 1, orderId = `test-${++sequence}`) {
      await pool.query("INSERT INTO orders(user_id, provider, link, create_at, odds, bet_money, money, status, raw, player_id, order_id) VALUES($1,$2,$3,$4,2,$5,$6,$7,$8,$9,$10)",
        [userId, provider, sign * (base + timestamp), timestamp + 86400000, bet, profit, status, raw, playerId, orderId]);
    }
    await insert(5e15, "OB", "Win", 100, 90);
    await insert(5e15, "OB", "Lose", 100, -100);
    await insert(5e15, "OB", "None", 300, 0);
    await insert(5e15, "OB", "Reject", 900, 0);
    await insert(5e15, "OB", "Return", 800, 0);
    // Other modes, wrong venue/sign and next-day Link must not leak into OB's first-day sample.
    await insert(0, "OB", "Win", 999, 999);
    await insert(4e15, "OB", "Win", 999, 999);
    await insert(6e15, "OB", "Win", 999, 999);
    await insert(5e15, "RAY", "Win", 999, 999);
    await insert(5e15, "OB", "Win", 999, 999, {}, ts, 1);
    await insert(5e15, "OB", "Win", 40, 8, {}, ts + 86400000);
    await insert(7e15, "OB", "Win", 100, 20);
    await insert(7e15, "PredictFun", "Win", 10, 2);
    await insert(7e15, "PredictFun", "None", 10, 1, { pfSellState: "closed" });
    await insert(7e15, "PredictFun", "Win", 999, 999, { pfSide: "sell" });
    await insert(7e15, "Polymarket", "None", 70, -3, { pmSellState: "closed" });
    await insert(7e15, "Polymarket", "None", 200, 10, { pmShares: 100, pmAttributedSellShares: 50 });
    await insert(7e15, "Polymarket", "Win", 999, 999, { pmSide: "sell" });
    await insert(7e15, "Polymarket", "Pending", 999, 999);
    await insert(7e15, "Polymarket", "None", 999, 999, { pmOrderType: "GTC", pmGtcBuyShares: 0 });
    await insert(7e15, "OB", "Win", 999, 999, {}, ts, 1);
    const ob = await fetchObSingleOrderAnalytics(start, start + 86400000);
    assert.equal(ob.byProvider.length, 1);
    assert.equal(ob.byProvider[0].total_orders, 5);
    assert.equal(ob.byProvider[0].total_profit, -10);
    assert.equal(ob.byProvider[0].total_bet, 500);
    assert.equal(ob.byProvider[0].settled_bet, 200);
    assert.equal(ob.byProvider[0].settled_profit, -10);
    assert.equal(ob.byProvider[0].pending_bet, 300);
    assert.equal(ob.byProvider[0].returns, 1);
    assert.equal(ob.byDay[0].day, "2026-11-17");
    assert.equal(ob.byOddsBucket[0].total_profit, -10);
    assert.deepEqual(await fetchObSingleOrderAnalytics(start, end, []), { byProvider: [], byOddsBucket: [], byDay: [], byAccount: [] });
    assert.equal((await fetchObSingleOrderAnalytics(start, end, [uid])).byProvider[0].total_orders, 6);
    const ev = await fetchValueBetProfitAnalytics(start, end);
    const pf = ev.byProvider.find(r => r.provider === "PredictFun");
    const pm = ev.byProvider.find(r => r.provider === "Polymarket");
    assert.equal(ev.byProvider.reduce((sum, r) => sum + r.total_orders, 0), 5);
    assert.equal(pf.total_profit, 3 * getExchange(Currency.USDT));
    assert.equal(pf.total_bet, 20 * getExchange(Currency.USDT));
    assert.equal(pf.pending, 0);
    assert.equal(pm.total_profit, 7);
    assert.equal(pm.settled_profit, -3);
    assert.equal(pm.settled_bet, 70);
    assert.equal(pm.pending_bet, 200);
    assert.equal(ev.byDay.reduce((sum, r) => sum + r.total_profit, 0), ev.byProvider.reduce((sum, r) => sum + r.total_profit, 0));
    const uid2 = "00000000-0000-4000-8000-000000000002", missingUser = "00000000-0000-4000-8000-000000000003";
    await pool.query("INSERT INTO profiles VALUES ($1,'same-name'), ($2,'same-name')", [uid, uid2]);
    await pool.query(`INSERT INTO players VALUES
      (1,$1,'OB','account-one','{"venueAccountName":"display-one"}',NULL),
      (2,$1,'OB','account-two','{}',123),
      (3,$2,'OB','other-owner-private-name','{}',NULL)`, [uid, uid2]);
    for (const base of [5e15, 7e15]) {
      await insert(base, "OB", "Win", 10, 6, {}, ts, -1, uid2, 3);
      await insert(base, "OB", "Lose", 4, -4, {}, ts, -1, uid, 2);
      await insert(base, "OB", "Win", 10, 3, {}, ts, -1, uid, 3);
      await insert(base, "OB", "Win", 10, 2, {}, ts, -1, uid, 999);
      await insert(base, "OB", "Win", 10, 1, {}, ts, -1, missingUser, null);
    }
    for (const load of [fetchObSingleOrderAnalytics, fetchValueBetProfitAnalytics]) {
      const result = await load(start, end);
      assert.equal(result.byAccount.reduce((sum, r) => sum + r.total_profit, 0), result.byProvider.reduce((sum, r) => sum + r.total_profit, 0));
      const find = (owner, id) => result.byAccount.find(r => r.user_id === owner && String(r.player_id) === String(id) && r.provider === "OB");
      assert.equal(find(uid, 1).account_name, "display-one");
      assert.equal(find(uid, 2).account_deleted, true);
      assert.equal(find(uid2, 3).total_profit, 6);
      assert.equal(find(uid, 3).account_name, "3"); // No other owner's display fields.
      assert.equal(find(uid, 999).account_name, "999");
      assert.equal(find(missingUser, null).user_name, null);
    }
    const auditStart = new Date(2026, 10, 20).getTime(), auditTs = auditStart + 3600000;
    await insert(5e15, "OB", "Win", 100, 30, {}, auditTs, -1, uid, 1, "duplicate");
    await insert(5e15, "OB", "Win", 100, 30, {}, auditTs, -1, uid, 2, "DUPLICATE");
    await insert(5e15, "OB", "Reject", 900, 0, {}, auditTs, -1, uid, 999, "duplicate");
    const deduped = await fetchObSingleOrderAnalytics(auditStart, auditStart + 86400000);
    assert.equal(deduped.byProvider[0].total_orders, 1);
    assert.equal(deduped.byProvider[0].total_profit, 30);
    assert.equal(deduped.byAccount.length, 1);
    assert.equal(Number(deduped.byAccount[0].player_id), 2);
    await insert(7e15, "Polymarket", "Return", 100, 0, { pmSellState: "settled", pmMatchResult: "equal_split" }, auditTs);
    await insert(7e15, "Polymarket", "Return", 500, 0, { pmSellState: "settled" }, auditTs);
    const neutral = await fetchValueBetProfitAnalytics(auditStart, auditStart + 86400000);
    assert.equal(neutral.byProvider[0].total_orders, 2);
    assert.equal(neutral.byProvider[0].total_bet, 100);
    assert.equal(neutral.byProvider[0].settled_bet, 100);
    assert.equal(neutral.byProvider[0].settled_orders, 1);
    assert.equal(neutral.byProvider[0].settled_profit, 0);
    console.log("Bet profit PostgreSQL: mode isolation, ROI, FX, user/account grouping, deduplication, neutral settlement and owner isolation passed");
  }
  finally { await pool.end(); }
});
