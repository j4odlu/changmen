/**
 * 一次性：从 players.account_data 剥离 Polymarket privateKey / private_key
 *
 *   cd server/backend && node scripts/ops/migrations/strip-pm-private-keys.mjs
 *   node scripts/ops/migrations/strip-pm-private-keys.mjs --apply
 *
 * 默认 dry-run；加 --apply 才写库。执行前请备份。
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";
import { stripPolymarketPrivateKeyFromToken } from "../../../core/account/pm_token_strip.js";

const apply = process.argv.includes("--apply");

loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();
if (!pool) {
  console.error("缺少 DATABASE_URL / 连接池");
  process.exit(1);
}

function stripToken(token) {
  if (token == null || typeof token !== "string")
    return { token, changed: false };
  const next = stripPolymarketPrivateKeyFromToken(token);
  return { token: next, changed: next !== token };
}

function stripAccountData(data) {
  if (!data || typeof data !== "object")
    return { data, changed: false };
  const next = { ...data };
  let changed = false;
  if (typeof next.token === "string") {
    const r = stripToken(next.token);
    if (r.changed) {
      next.token = r.token;
      changed = true;
    }
  }
  if (typeof next.Token === "string") {
    const r = stripToken(next.Token);
    if (r.changed) {
      next.Token = r.token;
      changed = true;
    }
  }
  return { data: next, changed };
}

const { rows } = await pool.query(`
  SELECT id, owner_user_id, player_name, provider, account_data
  FROM players
  WHERE deleted_at IS NULL
    AND (
      lower(coalesce(provider, '')) IN ('polymarket', 'pm')
      OR lower(coalesce(account_data->>'provider', '')) IN ('polymarket', 'pm')
    )
`);

let hit = 0;
for (const row of rows) {
  const { data, changed } = stripAccountData(row.account_data);
  if (!changed)
    continue;
  hit += 1;
  console.log(`[${apply ? "APPLY" : "DRY"}] player=${row.id} owner=${row.owner_user_id} name=${row.player_name}`);
  if (apply) {
    await pool.query(
      `UPDATE players SET account_data = $2::jsonb, updated_at = $3 WHERE id = $1`,
      [row.id, JSON.stringify(data), Date.now()],
    );
  }
}

console.log(`done: scanned=${rows.length} withPrivateKey=${hit} apply=${apply}`);
process.exit(0);
