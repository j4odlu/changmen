#!/usr/bin/env node
import { financialOrdersRelation } from "@changmen/db";
/**
 * 存量 players 回填 owner_user_id，并拆分多用户共用的 playerId。
 *
 * 前置：026_players_owner_user_id.sql 已执行
 *
 *   cd changmen/server/backend
 *   node scripts/ops/migrations/migrate-players-owner-user-id.mjs [--dry-run]
 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";

const dryRun = process.argv.includes("--dry-run");
loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();

function accountIdOf(row) {
  return Number(row?.accountId ?? row?.AccountId) || 0;
}

function replaceAccountId(accounts, oldId, newId) {
  let changed = false;
  const next = (accounts || []).map((row) => {
    if (accountIdOf(row) !== oldId)
      return row;
    changed = true;
    return { ...row, accountId: newId, AccountId: newId };
  });
  return changed ? next : accounts;
}

async function loadPlayerOwners() {
  /** @type {Map<number, Set<string>>} */
  const map = new Map();

  function add(playerId, userId) {
    const id = Number(playerId);
    const uid = String(userId || "").trim();
    if (!id || !uid)
      return;
    if (!map.has(id))
      map.set(id, new Set());
    map.get(id).add(uid);
  }

  const { rows: profiles } = await pool.query(`SELECT id, accounts FROM profiles`);
  for (const row of profiles) {
    for (const acc of row.accounts || []) {
      add(accountIdOf(acc), row.id);
    }
  }

  const { rows: orderOwners } = await pool.query(
    `SELECT DISTINCT user_id, player_id FROM ${financialOrdersRelation()} WHERE player_id > 0`,
  );
  for (const row of orderOwners) {
    add(row.player_id, row.user_id);
  }

  const { rows: logOwners } = await pool.query(
    `SELECT DISTINCT user_id, player_id FROM money_logs WHERE player_id > 0`,
  );
  for (const row of logOwners) {
    add(row.player_id, row.user_id);
  }

  return map;
}

async function orderCountByUser(playerId) {
  const { rows } = await pool.query(
    `SELECT user_id, COUNT(*)::int AS cnt
     FROM ${financialOrdersRelation()} WHERE player_id = $1
     GROUP BY user_id`,
    [playerId],
  );
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const row of rows)
    map.set(String(row.user_id), Number(row.cnt) || 0);
  return map;
}

function pickPrimaryOwner(owners, orderCounts) {
  const list = [...owners].sort();
  let best = list[0];
  let bestCount = orderCounts.get(best) || 0;
  for (const uid of list.slice(1)) {
    const cnt = orderCounts.get(uid) || 0;
    if (cnt > bestCount || (cnt === bestCount && uid < best)) {
      best = uid;
      bestCount = cnt;
    }
  }
  return best;
}

async function clonePlayer(client, player, ownerUserId) {
  const now = Date.now();
  const { rows } = await client.query(
    `INSERT INTO players (
       owner_user_id, platform_id, platform_name, player_name,
       credit, total_balance, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      ownerUserId,
      player.platform_id,
      player.platform_name,
      player.player_name,
      player.credit,
      player.total_balance,
      player.created_at || now,
      now,
    ],
  );
  return Number(rows[0]?.id) || 0;
}

async function updateProfileAccountId(client, userId, oldId, newId) {
  const { rows } = await client.query(
    `SELECT accounts FROM profiles WHERE id = $1`,
    [userId],
  );
  const accounts = rows[0]?.accounts || [];
  const next = replaceAccountId(accounts, oldId, newId);
  if (next === accounts)
    return false;
  await client.query(
    `UPDATE profiles SET accounts = $2::jsonb, updated_at = $3 WHERE id = $1`,
    [userId, JSON.stringify(next), Date.now()],
  );
  return true;
}

async function main() {
  const ownersByPlayer = await loadPlayerOwners();
  const { rows: players } = await pool.query(
    `SELECT id, owner_user_id, platform_id, platform_name, player_name,
            credit, total_balance, created_at, updated_at, deleted_at
     FROM players
     ORDER BY id ASC`,
  );

  const stats = {
    assigned: 0,
    split: 0,
    cloned: 0,
    orphan: 0,
    skipped: 0,
  };

  console.log(`[migrate-players-owner] players=${players.length} dryRun=${dryRun}`);

  for (const player of players) {
    const playerId = Number(player.id);
    if (player.owner_user_id) {
      stats.skipped += 1;
      continue;
    }

    const owners = ownersByPlayer.get(playerId) || new Set();
    if (owners.size === 0) {
      stats.orphan += 1;
      console.warn(`[migrate-players-owner] orphan player ${playerId} (${player.platform_name}/${player.player_name}) — 无 profile/order 引用`);
      continue;
    }

    const orderCounts = await orderCountByUser(playerId);
    const primary = pickPrimaryOwner(owners, orderCounts);
    const others = [...owners].filter(uid => uid !== primary);

    if (dryRun) {
      console.log(
        `[dry-run] player ${playerId}: primary=${primary} others=${others.join(",") || "(none)"}`,
      );
      stats.assigned += 1;
      stats.split += others.length > 0 ? 1 : 0;
      stats.cloned += others.length;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE players SET owner_user_id = $2, updated_at = $3 WHERE id = $1`,
        [playerId, primary, Date.now()],
      );
      stats.assigned += 1;

      for (const otherUserId of others) {
        const newId = await clonePlayer(client, player, otherUserId);
        if (!newId)
          throw new Error(`clone player ${playerId} for ${otherUserId} failed`);

        await updateProfileAccountId(client, otherUserId, playerId, newId);
        await client.query(
          `UPDATE ${financialOrdersRelation()} SET player_id = $3 WHERE user_id = $1 AND player_id = $2`,
          [otherUserId, playerId, newId],
        );
        await client.query(
          `UPDATE money_logs SET player_id = $3 WHERE user_id = $1 AND player_id = $2`,
          [otherUserId, playerId, newId],
        );
        stats.cloned += 1;
        console.log(`[migrate-players-owner] split player ${playerId} → ${newId} for user ${otherUserId}`);
      }

      if (others.length > 0)
        stats.split += 1;

      await client.query("COMMIT");
    }
    catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    finally {
      client.release();
    }
  }

  const { rows: missing } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM players WHERE deleted_at IS NULL AND owner_user_id IS NULL`,
  );
  const activeMissing = Number(missing[0]?.cnt) || 0;
  console.log("[migrate-players-owner] done:", stats);
  console.log(`[migrate-players-owner] active players without owner_user_id: ${activeMissing}`);
  if (activeMissing > 0) {
    console.warn("[migrate-players-owner] 仍有未归属的活跃 player，请人工处理后再部署新代码");
  }
}

main().catch((err) => {
  console.error("[migrate-players-owner] failed:", err.message);
  process.exit(1);
});
