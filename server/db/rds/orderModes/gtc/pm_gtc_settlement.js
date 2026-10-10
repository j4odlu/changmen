import { gtcOrderLedger } from "./pm_gtc_ledger.js";

/** [changmen 扩展] 同事务校准本原单；卖出与余仓结算按现金事实幂等计算。 */
export async function syncPmGtcSettledOrderFinancials(client, owner, playerId, orderId, executionId) {
  const selected = await client.query(`SELECT id,bet_money,money,status,raw FROM orders
    WHERE user_id=$1 AND player_id=$2 AND lower(order_id)=lower($3) AND provider='Polymarket'
      AND raw->>'pmGtcExecutionId'=$4 AND lower(COALESCE(raw->>'pmSide','buy'))<>'sell' FOR UPDATE`,
  [owner, playerId, orderId, executionId]);
  const updated = [];
  for (const row of selected.rows) {
    const ledger = gtcOrderLedger(row);
    if (!ledger || (Number(row.money) === ledger.money && JSON.stringify(row.raw) === JSON.stringify(ledger.raw))) continue;
    const result = await client.query(`UPDATE orders SET money=$3,raw=$4
      WHERE id=$1 AND user_id=$2 RETURNING id,order_id,bet_money,money`, [row.id, owner, ledger.money, ledger.raw]);
    updated.push(...result.rows);
  }
  return updated;
}
