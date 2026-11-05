/** Local-only PostgreSQL regression for final-payout rechecks; never reads or writes production orders. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { withTemporaryPostgres } from "./temporary-postgres.mjs";

await withTemporaryPostgres(async ({ port }) => {
  const db = await import("@changmen/db");
  const { upsertPmGtcOrders } = await import("../../rds/rds/orderModes/gtc/pm_gtc_orders_store.js");
  const { mergeOrderLogicalSave } = await import("../../server/backend/core/account/order_store.js");
  const pool = db.getPgPool();
  const connection = new URL(pool.options.connectionString);
  assert.equal(connection.hostname, "127.0.0.1");
  assert.equal(Number(connection.port), port);
  const owner = "550e8400-e29b-41d4-a716-446655440000";
  const condition = "0x" + "a".repeat(64);
  const receipt = price => ({ conditionId: condition, assetId: "102", price, source: price === 0.5 ? "resolution" : "clob" });
  const checks = [];
  try {
    await pool.query(`CREATE TABLE orders (
      id bigserial PRIMARY KEY, user_id uuid, player_id bigint, order_id text, link bigint,
      provider text, match text, bet text, item text, odds float8, bet_money float8,
      money float8, status text, create_at bigint, raw jsonb,
      UNIQUE(user_id,order_id,player_id))`);
    const base = { pmOrigin:"changmen",pmSide:"buy",pmConditionId:condition,pmTokenId:"102",
      pmShares:100,pmStakeUsdc:40,pmSellState:"settled",pmMatchResult:"win" };
    const fixtures = [
      ["old-fok",1,"Lose",base], ["old-gtc",1,"Lose",{...base,pmGtcExecutionId:"local-gtc",pmGtcResultRevision:6,
        pmShares:18.66,pmStakeUsdc:10.6795,pmGtcBuyShares:18.66,pmGtcBuyCost:10.6795,pmAttributedSellShares:0}],
      ["verified-win",1,"Win",{...base,pmSettlement:receipt(1)}],
      ["verified-lose",1,"Lose",{...base,pmMatchResult:"lose",pmSettlement:receipt(0)}],
      ["wrong-asset",1,"Win",{...base,pmSettlement:{...receipt(1),assetId:"other"}}],
      ["wrong-price",1,"Win",{...base,pmSettlement:{...receipt(1),price:"1"}}],
      ["closed",1,"None",{...base,pmSellState:"closed",pmAttributedSellShares:100}],
      ["open",1,"None",{...base,pmSellState:"open"}],
      ["recent",10001,"Win",{...base,pmSettlement:receipt(1)}],
      ["flat-unverified",1,"Return",base], ["pending",1,"Pending",base],
      ["unfilled",1,"Return",{...base,pmShares:0}],
    ];
    for (const [id,at,status,raw] of fixtures) {
      await pool.query(`INSERT INTO orders(user_id,player_id,order_id,link,provider,match,bet,item,odds,bet_money,money,status,create_at,raw)
        VALUES($1,292,$2,1,'Polymarket','Home vs Away','Map 2','Away',2,$3,$4,$5,$6,$7)`,
      [owner,id,id === "old-gtc" ? 71.55265000000001 : 268,id === "old-gtc" ? 53.4693 : -268,status,at,raw]);
    }
    const loaded = await db.fetchOrdersByPlayerStrict(292, owner, { sinceCreateAt:10000 });
    assert.deepEqual(loaded.map(r=>r.order_id).sort(),["old-fok","old-gtc","wrong-asset","wrong-price","open","recent","flat-unverified"].sort());
    checks.push("old settled rows without valid bound evidence remain eligible beyond the recent trade window");
    for (const id of ["old-fok","old-gtc"]) {
      const original = loaded.find(r=>r.order_id===id);
      const money = id === "old-gtc" ? -9.04165 : 67;
      const incoming = { ...original.raw,provider:"Polymarket",orderId:id,betMoney:original.bet_money,money,
        status:money>0?"win":"lose",pmMatchResult:"equal_split",pmSettlement:receipt(0.5),pmSellState:"settled" };
      const result = mergeOrderLogicalSave(original,original.raw,incoming,"changmen");
      const row = { ...original,...result,status:result.raw.status === "win" ? "Win" : "Lose" };
      assert.equal(await (id === "old-gtc" ? upsertPmGtcOrders([row]) : db.upsertOrders([row])),true);
      const saved = (await pool.query("SELECT * FROM orders WHERE order_id=$1",[id])).rows[0];
      assert.equal(saved.status,id === "old-gtc" ? "Lose" : "Win");
      assert.equal(saved.money,id === "old-gtc" ? -9.0417 : 67);
      assert.equal(saved.raw.pmMatchResult,"equal_split");
      assert.equal(saved.raw.pmSellState,"settled");
      assert.deepEqual(saved.raw.pmSettlement,receipt(0.5));
      assert.equal(saved.bet_money,original.bet_money);
      const stale = mergeOrderLogicalSave(saved,saved.raw,{...original.raw,provider:"Polymarket",money:999,status:"win",betMoney:999},"changmen");
      assert.equal(stale.money,saved.money);
      assert.equal(stale.bet_money,saved.bet_money);
      assert.deepEqual(stale.raw.pmSettlement,receipt(0.5));
    }
    checks.push("FOK and GTC persist final receipts with consistent financial status and money, preserving original costs");
    const remaining = await db.fetchOrdersByPlayerStrict(292,owner,{sinceCreateAt:10000});
    assert(!remaining.some(r=>["old-fok","old-gtc"].includes(r.order_id)));
    checks.push("verified final rows stop background rechecking and late unverified snapshots cannot roll them back");
    fs.mkdirSync("output/pm-half-payout-implementation",{recursive:true});
    fs.writeFileSync("output/pm-half-payout-implementation/recheck-postgres-result.json",JSON.stringify({passed:true,localOnly:true,productionWrites:0,checks},null,2));
    console.log(JSON.stringify({passed:true,localOnly:true,productionWrites:0,checks},null,2));
  } finally { await pool.end(); }
});
