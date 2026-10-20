#!/usr/bin/env node
/**
 * GB14：将 platform_name「品牌+账号」改为纯品牌名（对齐赢博/雷竞技显示）
 * Usage: node scripts/fix-gb14-platform-names.mjs [--apply]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool, upsertTagPlatformByName } from "@changmen/db";
import { playerRowToAccountRecord } from "../../../../../rds/player_account_record.js";
import { loadAccountsForUser } from "../../../core/db/store.js";

const APPLY = process.argv.includes("--apply");
const USER_NAME = "gb14";

/** playerId → 目标平台标签（90 已改过，其余 OB 拼接名） */
const TARGET_BY_PLAYER = new Map([
  [90, "好博"],
  [91, "OD"],
  [92, "好博"],
  [93, "米兰"],
  [94, "好博"],
  [95, "星空"],
  [96, "好博"],
  [97, "九游"],
  [98, "好博"],
  [99, "开云"],
]);

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

const { rows: players } = await pool.query(
  `SELECT id, platform_id, platform_name, player_name, provider, account_data
   FROM players
   WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
   ORDER BY id`,
  [ownerUserId],
);

const tagIdByName = new Map();
async function tagId(name) {
  const label = String(name || "").trim();
  if (!label)
    return null;
  if (tagIdByName.has(label))
    return tagIdByName.get(label);
  const row = await upsertTagPlatformByName(label);
  const id = row?.id ? Number(row.id) : null;
  tagIdByName.set(label, id);
  return id;
}

const planned = [];
for (const row of players) {
  const id = Number(row.id);
  const target = TARGET_BY_PLAYER.get(id);
  if (!target)
    continue;
  if (String(row.platform_name || "").trim() === target)
    continue;
  const platformId = await tagId(target);
  if (!platformId)
    throw new Error(`tag_platform failed: ${target}`);
  planned.push({
    id,
    from: row.platform_name,
    to: target,
    platformId,
    playerName: row.player_name,
  });
}

if (!planned.length) {
  console.log("nothing to change");
  await pool.end();
  process.exit(0);
}

console.log("=== planned updates ===");
for (const p of planned) {
  console.log(`${p.id}\t${p.from} → ${p.to}\t(player=${p.playerName})`);
}

for (const p of planned) {
  const { rows: conflict } = await pool.query(
    `SELECT id FROM players
     WHERE owner_user_id = $1::uuid AND deleted_at IS NULL
       AND platform_id = $2 AND player_name = $3 AND id <> $4`,
    [ownerUserId, p.platformId, p.playerName, p.id],
  );
  if (conflict.length) {
    throw new Error(
      `conflict player ${p.id} → ${p.to}: platform_id=${p.platformId} player_name=${p.playerName} taken by ${conflict[0].id}`,
    );
  }
}

if (!APPLY) {
  console.log("\n[dry-run] pass --apply to write");
  await pool.end();
  process.exit(0);
}

const now = Date.now();
for (const p of planned) {
  const { rowCount } = await pool.query(
    `UPDATE players
     SET platform_id = $2, platform_name = $3, updated_at = $4
     WHERE id = $1 AND owner_user_id = $5::uuid AND deleted_at IS NULL`,
    [p.id, p.platformId, p.to, now, ownerUserId],
  );
  if (!rowCount)
    throw new Error(`update failed for player ${p.id}`);
}

await loadAccountsForUser(ownerUserId);

console.log("\n=== after (display preview) ===");
const { rows: after } = await pool.query(
  `SELECT id, platform_id, platform_name, player_name, provider, account_data
   FROM players WHERE owner_user_id = $1::uuid AND deleted_at IS NULL ORDER BY id`,
  [ownerUserId],
);
for (const row of after) {
  const wire = playerRowToAccountRecord({
    id: row.id,
    platformId: row.platform_id,
    platformName: row.platform_name,
    playerName: row.player_name,
    provider: row.provider,
    accountData: row.account_data,
  });
  const right = wire.venueAccountName || wire.playerName;
  console.log(`${wire.accountId}\t${wire.platformName} / ${right}`);
}

console.log("\ndone — 生产环境请 pm2 restart changmen-esport");
await pool.end();
