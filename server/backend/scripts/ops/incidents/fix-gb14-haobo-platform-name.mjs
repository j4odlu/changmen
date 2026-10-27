#!/usr/bin/env node
/**
 * GB14 player 90：platform_name 好博zmmzmm1 → 好博（仅显示标签，不改凭证）
 * Usage: node scripts/fix-gb14-haobo-platform-name.mjs [--apply]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady, getPgPool, upsertTagPlatformByName } from "@changmen/db";
import { playerRowToAccountRecord } from "../../../../../rds/player_account_record.js";
import { loadAccountsForUser } from "../../../core/db/store.js";

const APPLY = process.argv.includes("--apply");
const PLAYER_ID = 90;
const NEW_PLATFORM_NAME = "好博";
const USER_NAME = "gb14";

loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();

const { rows: users } = await pool.query(
  `SELECT id FROM profiles WHERE user_name ILIKE $1`,
  [USER_NAME],
);
const ownerUserId = users[0]?.id;
if (!ownerUserId)
  throw new Error(`user not found: ${USER_NAME}`);

const { rows: beforeRows } = await pool.query(
  `SELECT id, platform_id, platform_name, player_name, provider, account_data
   FROM players
   WHERE id = $1 AND owner_user_id = $2::uuid AND deleted_at IS NULL`,
  [PLAYER_ID, ownerUserId],
);
const before = beforeRows[0];
if (!before)
  throw new Error(`player ${PLAYER_ID} not found for ${USER_NAME}`);

const tag = await upsertTagPlatformByName(NEW_PLATFORM_NAME);
if (!tag?.id)
  throw new Error(`tag_platform upsert failed: ${NEW_PLATFORM_NAME}`);

const conflict = await pool.query(
  `SELECT id, platform_name, player_name
   FROM players
   WHERE owner_user_id = $1::uuid
     AND deleted_at IS NULL
     AND platform_id = $2
     AND player_name = $3
     AND id <> $4`,
  [ownerUserId, tag.id, before.player_name, PLAYER_ID],
);
if (conflict.rows.length) {
  throw new Error(
    `conflict: platform_id=${tag.id} player_name=${before.player_name} already used by player ${conflict.rows[0].id}`,
  );
}

console.log("=== before ===");
console.log(JSON.stringify({
  accountId: before.id,
  platformId: before.platform_id,
  platformName: before.platform_name,
  playerName: before.player_name,
  venueAccountName: before.account_data?.venueAccountName,
}, null, 2));

console.log("\n=== planned ===");
console.log(JSON.stringify({
  platformId: Number(tag.id),
  platformName: NEW_PLATFORM_NAME,
  playerName: before.player_name,
}, null, 2));

if (!APPLY) {
  console.log("\n[dry-run] pass --apply to write");
  await pool.end();
  process.exit(0);
}

const now = Date.now();
const { rowCount } = await pool.query(
  `UPDATE players
   SET platform_id = $2,
       platform_name = $3,
       updated_at = $4
   WHERE id = $1 AND owner_user_id = $5::uuid AND deleted_at IS NULL`,
  [PLAYER_ID, Number(tag.id), NEW_PLATFORM_NAME, now, ownerUserId],
);
if (!rowCount)
  throw new Error("update affected 0 rows");

await loadAccountsForUser(ownerUserId);

const { rows: afterRows } = await pool.query(
  `SELECT id, platform_id, platform_name, player_name, account_data
   FROM players WHERE id = $1`,
  [PLAYER_ID],
);
const wire = playerRowToAccountRecord({
  id: afterRows[0].id,
  platformId: afterRows[0].platform_id,
  platformName: afterRows[0].platform_name,
  playerName: afterRows[0].player_name,
  accountData: afterRows[0].account_data,
});

console.log("\n=== after ===");
console.log(JSON.stringify({
  accountId: wire.accountId,
  platformId: wire.platformId,
  platformName: wire.platformName,
  playerName: wire.playerName,
  venueAccountName: wire.venueAccountName,
  display: `${wire.platformName} / ${wire.venueAccountName || wire.playerName}`,
}, null, 2));

console.log("\ndone — 若生产环境请 pm2 restart changmen-esport 刷新其它进程缓存");
await pool.end();
