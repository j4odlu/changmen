/** POD 自动下注执行权。唯一键在场馆调用之前生效，禁止重复外部下注。 */
import { getPgPool } from "./common.js";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS pod_bet_executions (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  alert_id text NOT NULL,
  venue text NOT NULL,
  player_id bigint NOT NULL,
  lease_token uuid NOT NULL,
  state text NOT NULL DEFAULT 'reserved',
  venue_order_id text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  lease_until bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  CHECK (venue IN ('OB', 'Polymarket', 'RAY')),
  CHECK (state IN ('reserved', 'accepted', 'failed', 'unknown')),
  UNIQUE (user_id, alert_id, venue, player_id)
)`;

let ensured = false;

async function ensureTable(pool) {
  if (ensured)
    return;
  await pool.query(TABLE_DDL);
  // [changmen 扩展] 兼容已有执行权表；事务内扩展场馆约束。
  await pool.query(`DO $$ BEGIN
    ALTER TABLE pod_bet_executions DROP CONSTRAINT IF EXISTS pod_bet_executions_venue_check;
    ALTER TABLE pod_bet_executions ADD CONSTRAINT pod_bet_executions_venue_check CHECK (venue IN ('OB', 'Polymarket', 'RAY'));
  END $$`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS pod_bet_executions_token_uidx ON pod_bet_executions (lease_token)");
  await pool.query("CREATE INDEX IF NOT EXISTS pod_bet_executions_user_updated_idx ON pod_bet_executions (user_id, updated_at DESC)");
  ensured = true;
}

const RETURNING = `id, alert_id, venue, player_id, lease_token, state,
  venue_order_id, message, lease_until, created_at, updated_at`;

export async function reservePodBetExecution(row) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  await ensureTable(pool);
  const inserted = await pool.query(`
    INSERT INTO pod_bet_executions (
      user_id, alert_id, venue, player_id, lease_token, state,
      venue_order_id, message, lease_until, created_at, updated_at
    ) VALUES ($1::uuid, $2, $3, $4, $5::uuid, 'reserved', '', '', 0, $6, $6)
    ON CONFLICT (user_id, alert_id, venue, player_id) DO NOTHING
    RETURNING ${RETURNING}
  `, [row.userId, row.alertId, row.venue, row.playerId, row.leaseToken, row.now]);
  if (inserted.rows[0])
    return { acquired: true, row: inserted.rows[0] };
  const existing = await pool.query(`
    SELECT ${RETURNING}
    FROM pod_bet_executions
    WHERE user_id = $1::uuid AND alert_id = $2 AND venue = $3 AND player_id = $4
    LIMIT 1
  `, [row.userId, row.alertId, row.venue, row.playerId]);
  return { acquired: false, row: existing.rows[0] || null };
}

export async function finalizePodBetExecution(row) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  await ensureTable(pool);
  const result = await pool.query(`
    UPDATE pod_bet_executions
    SET state = $3, venue_order_id = $4, message = $5, updated_at = $6
    WHERE user_id = $1::uuid AND lease_token = $2::uuid AND state = 'reserved'
    RETURNING ${RETURNING}
  `, [row.userId, row.leaseToken, row.state, row.venueOrderId, row.message, row.now]);
  return result.rows[0] || null;
}
