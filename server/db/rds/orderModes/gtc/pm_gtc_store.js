import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";
/** [changmen 扩展] GTC V1 持久化/一次性授权；不参与原 FOK 存储路径。 */
import { getPgPool } from "../../common.js";
import { resolveGtcFinancialOrder } from "./pm_gtc_financial.js";

let schema;
async function poolReady() {
  const pool = getPgPool();
  if (!pool)
    throw new Error("GTC 需要可用的 RDS 持久化，不能降级为 FOK");
  schema ??= pool.query(`CREATE TABLE IF NOT EXISTS pm_gtc_executions (
    id uuid PRIMARY KEY, owner uuid NOT NULL, wallet_key text NOT NULL,
    active boolean NOT NULL DEFAULT true, record jsonb NOT NULL, updated_at bigint NOT NULL);
    CREATE INDEX IF NOT EXISTS pm_gtc_wallet_active ON pm_gtc_executions(wallet_key) WHERE active;
    CREATE INDEX IF NOT EXISTS pm_gtc_owner ON pm_gtc_executions(owner)`)
    .catch((error) => { schema = undefined; throw error; });
  await schema; return pool;
}
export async function listPmGtc(owner) {
  const pool = await poolReady();
  const result = await pool.query("SELECT record FROM pm_gtc_executions WHERE owner=$1 AND (active OR id IN (SELECT id FROM pm_gtc_executions WHERE owner=$1 ORDER BY updated_at DESC LIMIT 500)) ORDER BY updated_at DESC", [owner]);
  // [changmen 扩展] Historical mode repair belongs to GTC recovery. Ordinary reads never query this table.
  // Match the exact owned original (or its sell parent), never a Link or current preference.
  await pool.query(`UPDATE orders o SET raw=COALESCE(o.raw,'{}'::jsonb) || jsonb_build_object('pmGtcExecutionId',e.id::text)
    FROM pm_gtc_executions e CROSS JOIN LATERAL (VALUES
      ((e.record->'plan'->>'playerId')::bigint,'Polymarket',e.record->>'orderId'),
      ((e.record->'plan'->>'playerId')::bigint,'Polymarket',e.record->'plan'->>'orderHash'),
      ((e.record->'plan'->>'otherPlayerId')::bigint,e.record->'plan'->>'otherProvider',e.record->'other'->>'orderId')
    ) AS anchor(player_id,provider,order_id)
    WHERE e.owner=$1 AND o.user_id=$1 AND o.player_id=anchor.player_id AND o.provider=anchor.provider
      AND NULLIF(anchor.order_id,'') IS NOT NULL
      AND LOWER(COALESCE(NULLIF(o.raw->>'pmBuyOrderId',''),NULLIF(o.raw->>'pfBuyOrderId',''),o.order_id))=LOWER(anchor.order_id)
      AND NULLIF(o.raw->>'pmGtcExecutionId','') IS NULL`, [owner]);
  return result.rows.map(r => r.record);
}
export async function createPmGtc({ id, owner, walletKey, maker, plan }) {
  const pool = await poolReady(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [walletKey]);
    const existing = await client.query("SELECT record FROM pm_gtc_executions WHERE id=$1", [id]);
    if (existing.rows.length) {
      const row = existing.rows[0].record;
      if (row.owner !== owner || row.walletKey !== walletKey || JSON.stringify(row.plan) !== JSON.stringify(plan))
        throw new Error("GTC 执行身份冲突");
      await client.query("COMMIT"); return row;
    }
    // [changmen 扩展] 手动下单由用户逐次决定；同钱包可保存多笔独立原单。
    // 自动双腿执行仍使用原钱包门控；每个执行 ID 的幂等与一次性授权均保留。
    if (plan.source !== "manual") {
      const active = await client.query("SELECT id FROM pm_gtc_executions WHERE wallet_key=$1 AND active", [walletKey]);
      if (active.rows.length)
        throw new Error("此 PM 钱包已有 GTC 未完结记录，请先核实原单并恢复自动下注");
    }
    const row = createGtcExecution(id, owner, walletKey, maker, plan, Date.now());
    await client.query("INSERT INTO pm_gtc_executions(id,owner,wallet_key,record,updated_at) VALUES($1,$2,$3,$4,$5)", [id, owner, walletKey, row, Date.now()]);
    await client.query("COMMIT"); return row;
  }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function mutatePmGtc(owner, id, revision, command) {
  const pool = await poolReady(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 与同钱包创建共用事务锁；逐笔更新事实，手动多单仍按执行 ID 隔离。
    const lookup = await client.query("SELECT wallet_key FROM pm_gtc_executions WHERE id=$1 AND owner=$2", [id, owner]);
    if (!lookup.rows.length)
      throw new Error("GTC 记录不存在或无权操作");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lookup.rows[0].wallet_key]);
    const result = await client.query("SELECT record FROM pm_gtc_executions WHERE id=$1 AND owner=$2 FOR UPDATE", [id, owner]);
    const old = result.rows[0].record;
    if (old.revision !== revision)
      throw new Error("GTC 记录已更新，请重新读取；禁止重放提交授权");
    const row = applyGtcCommand(old, command, Date.now());
    const financial = resolveGtcFinancialOrder(row, command.financialOrder);
    if (financial)
      row.financialOrder = financial;
    else
      delete row.financialOrder;
    await client.query("UPDATE pm_gtc_executions SET record=$3,active=$4,updated_at=$5 WHERE id=$1 AND owner=$2", [id, owner, row, !row.released, Date.now()]);
    if (row.other.orderId) {
      // Counterpart venues retain their own ledger. Tag only the exact original.
      await client.query(`UPDATE orders SET link=$5, raw=raw || jsonb_build_object('pmGtcExecutionId',$6::text)
        WHERE user_id=$1 AND player_id=$2 AND provider=$3 AND LOWER(order_id)=LOWER($4)
          AND (NULLIF(raw->>'pmGtcExecutionId','') IS NULL OR raw->>'pmGtcExecutionId'=$6)`, [owner, row.plan.otherPlayerId, row.plan.otherProvider, row.other.orderId, row.plan.linkId, id]);
    }
    // 接受零成交只建执行记录，真实买单有完整成交/费用事实后才进入财务订单表。
    if (financial && (financial.pmShares > 0 || Object.values(row.fills).some(fill => fill.status === "FAILED"))) {
      const shares = financial.pmShares; const cost = financial.pmStakeUsdc;
      const raw = { pmGtcExecutionId: id, pmGtcRevision: row.revision, pmTokenId: row.plan.tokenId, pmConditionId: row.plan.conditionId, pmSide: "buy", pmOrigin: "changmen", pmShares: shares, pmFillPrice: financial.pmFillPrice, pmStakeUsdc: cost, pmFeeUsdc: financial.pmFeeUsdc, pmGtcBuyShares: shares, pmGtcBuyCost: cost, betMoney: financial.betMoney };
      // 保留人工卖出/赛果等已有字段；历史买入量与剩余净持仓分开。
      await client.query(`INSERT INTO orders(user_id,player_id,order_id,link,provider,match,bet,item,odds,bet_money,money,status,create_at,raw)
        VALUES($1,$2,$3,$4,'Polymarket',$5,$6,$7,$8,$9,0,'None',$10,$11)
        ON CONFLICT(user_id,order_id,player_id) DO UPDATE SET
        odds=EXCLUDED.odds,
        bet_money=EXCLUDED.bet_money,
        raw=COALESCE(orders.raw,'{}'::jsonb) || EXCLUDED.raw || jsonb_build_object(
          'pmShares', $12::float8,
          'pmStakeUsdc', CASE WHEN $12::float8>0 THEN greatest(0,$13-COALESCE((orders.raw->>'pmSellProceeds')::float8,0)+COALESCE((orders.raw->>'pmRealizedPnlUsdc')::float8,0)) ELSE 0 END)`, [owner, row.plan.playerId, row.orderId, row.plan.linkId, row.plan.match, row.plan.bet, row.plan.item, financial.odds, financial.betMoney, row.createdAt, raw, shares, cost]);
    }
    await client.query("COMMIT"); return row;
  }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
