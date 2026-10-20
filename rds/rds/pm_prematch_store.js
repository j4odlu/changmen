/** [changmen 扩展] C 行历史价独立持久化，按 token + 登记时间截止点保留版本。 */
import { getPgPool } from "./common.js";

export async function ensurePmPrematchSchema() {
  const pool = getPgPool();
  if (!pool) throw new Error("PM 历史价数据库不可用");
  await pool.query(`CREATE TABLE IF NOT EXISTS pm_prematch_prices (
    token_id text NOT NULL,
    cutoff bigint NOT NULL,
    market_id text NOT NULL,
    checked_at bigint NOT NULL,
    snapshot jsonb NOT NULL,
    PRIMARY KEY (token_id, cutoff)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS pm_prematch_prices_latest
    ON pm_prematch_prices (token_id, checked_at DESC)`);
}

export async function fetchPmPrematchPrices(tokenIds) {
  const ids = [...new Set((tokenIds || []).map(String).filter(Boolean))];
  const pool = getPgPool();
  if (!pool || !ids.length) return {};
  try {
    const { rows } = await pool.query(`SELECT DISTINCT ON (token_id) token_id, snapshot
      FROM pm_prematch_prices WHERE token_id = ANY($1::text[])
      ORDER BY token_id, checked_at DESC, cutoff DESC`, [ids]);
    return Object.fromEntries(rows.map(row => [row.token_id, row.snapshot]));
  }
  catch (error) {
    // 滚动发布时 collector 建表前的旧 API 仍可正常返回比赛。
    if (error.code === "42P01") return {};
    throw error;
  }
}

export async function writePmPrematchPrices(records) {
  const pool = getPgPool();
  if (!pool) throw new Error("PM 历史价数据库不可用");
  if (!records.length) return;
  await pool.query(`INSERT INTO pm_prematch_prices (token_id, cutoff, market_id, checked_at, snapshot)
    SELECT r->>'tokenId', (r->>'cutoff')::bigint, r->>'marketId', (r->>'checkedAt')::bigint, r
    FROM jsonb_array_elements($1::jsonb) r
    ON CONFLICT (token_id, cutoff) DO UPDATE
    SET snapshot = EXCLUDED.snapshot, checked_at = EXCLUDED.checked_at
    WHERE pm_prematch_prices.checked_at <= EXCLUDED.checked_at`, [JSON.stringify(records)]);
}
