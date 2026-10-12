import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";

export const OWNER = "00000000-0000-4000-8000-000000000001";
export const EXECUTION = "00000000-0000-4000-8000-000000000011";
export const HASH = `0x${"a".repeat(64)}`;

export function accepted(id = EXECUTION, hash = HASH) {
  const now = Date.now();
  const plan = { shares: "10", orderHash: hash, originalPmLeg: "A", playerId: 1, otherPlayerId: 2, otherProvider: "RAY", fx: 6.7, linkId: 123, tokenId: "test-token", conditionId: "test-condition", match: "test match", bet: "test bet", item: "test item" };
  const initial = createGtcExecution(id, OWNER, "test-wallet", "test-maker", plan, now);
  const row = applyGtcCommand(applyGtcCommand(initial, { kind: "authorize_pm" }, now), { kind: "ack", state: "accepted", orderId: hash }, now);
  // 验证完整 payload / 未知历史字段不被财务消费者改写。
  row.testUnknownExtension = { preserved: ["unknown", 1] };
  return row;
}

export function facts(hash = HASH) {
  const now = Date.now();
  return { kind: "facts", facts: {
    order: { id: hash, original: "10", matched: "5", status: "LIVE", tradeIds: ["test-fill"] },
    fills: [{ key: "test-fill:maker", tradeId: "test-fill", bucket: "maker", role: "MAKER", shares: "5", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: now }],
    complete: true,
    observedAt: now,
  }, financialOrder: { pmShares: 5, pmFillPrice: 0.5, pmStakeUsdc: 2.5, pmFeeUsdc: 0, odds: 2, betMoney: 16.75 } };
}

export function financialRow(orderId = "ordinary-first", raw = {}) {
  return { user_id: OWNER, player_id: 1, order_id: orderId, link: 123, provider: "Polymarket", match: "test match", bet: "test bet", item: "test item", odds: 2, bet_money: 16.75, money: 0, status: "None", create_at: Date.now(), raw };
}

export async function seedControl(pool, { ready = false, row = accepted(), orderId = row.plan.orderHash, raw = {} } = {}) {
  await pool.query(`INSERT INTO pm_gtc_executions(id,owner,wallet_key,active,record,updated_at)
    VALUES($1,$2,$3,$4,$5,$6)`, [row.id, row.owner, row.walletKey, !row.released, row, row.createdAt]);
  const result = await pool.query(`INSERT INTO orders(user_id,player_id,order_id,provider,create_at,raw,
    execution_kind,execution_id,execution_wallet_key,execution_active,execution_record,execution_updated_at,financial_ready)
    VALUES($1,$2,$3,'Polymarket',$4,$5,'pm-gtc-v1',$6,$7,$8,$9,$10,$11) RETURNING *`, [row.owner, row.plan.playerId, orderId, row.createdAt, raw, row.id, row.walletKey, !row.released, row, row.createdAt, ready]);
  return { execution: row, order: result.rows[0] };
}
