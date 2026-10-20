/**
 * storage/tag_platforms.json + players.json → RDS（幂等合并，可重复执行）。
 * VPS 部署后运行：cd server/backend && npm run db:migrate-players
 */
import { readJsonFile } from "@changmen/storage/json_file_store.js";
import { getPgPool } from "./pg_pool.js";

function rowId(row) {
  return Number(row?.id ?? row?.ID ?? row?.playerId ?? 0);
}

export async function migratePlayersJsonToRds() {
  const pool = getPgPool();
  if (!pool)
    return { ok: false, skipped: true, reason: "no DATABASE_URL" };

  const tagPlatforms = readJsonFile("tag_platforms", {});
  const players = readJsonFile("players", {});
  const platformEntries = Object.values(tagPlatforms || {});
  const playerEntries = Object.values(players || {});

  if (!platformEntries.length && !playerEntries.length) {
    return { ok: true, skipped: true, reason: "no json data" };
  }

  const stats = {
    tagPlatforms: { inserted: 0, updated: 0, skipped: 0 },
    players: { inserted: 0, updated: 0, skipped: 0 },
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of platformEntries) {
      const id = rowId(row);
      const name = String(row?.name ?? row?.Name ?? "").trim();
      if (!id || !name) {
        stats.tagPlatforms.skipped += 1;
        continue;
      }
      const createdAt = Number(row?.createdAt) || Date.now();
      const updatedAt = Number(row?.updatedAt) || createdAt;
      try {
        const { rows } = await client.query(
          `INSERT INTO tag_platforms (id, name, created_at, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             updated_at = GREATEST(tag_platforms.updated_at, EXCLUDED.updated_at)
           RETURNING id, (xmax = 0) AS inserted`,
          [id, name, createdAt, updatedAt],
        );
        if (!rows?.length) {
          stats.tagPlatforms.skipped += 1;
          continue;
        }
        if (rows[0].inserted)
          stats.tagPlatforms.inserted += 1;
        else stats.tagPlatforms.updated += 1;
      }
      catch (err) {
        if (err.code === "23505") {
          stats.tagPlatforms.skipped += 1;
          console.warn(`[migrate-players] tag_platform id=${id} name=${name} 冲突，已跳过`);
        }
        else {
          throw err;
        }
      }
    }

    for (const row of playerEntries) {
      const id = rowId(row);
      const platformId = Number(row?.platformId ?? row?.platform_id) || 0;
      if (!id || !platformId) {
        stats.players.skipped += 1;
        continue;
      }
      const createdAt = Number(row?.createdAt) || Date.now();
      const updatedAt = Number(row?.updatedAt) || createdAt;
      const { rows: exists } = await client.query(
        "SELECT id FROM players WHERE id = $1",
        [id],
      );
      if (!exists?.length) {
        stats.players.skipped += 1;
        console.warn(`[migrate-players] skip insert player id=${id}（changmen 要求 owner_user_id，legacy JSON 仅更新已有行）`);
        continue;
      }
      const { rows } = await client.query(
        `INSERT INTO players (
           id, platform_id, platform_name, player_name, credit, total_balance,
           created_at, updated_at, deleted_at, delete_description
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           platform_id = EXCLUDED.platform_id,
           platform_name = EXCLUDED.platform_name,
           player_name = EXCLUDED.player_name,
           credit = EXCLUDED.credit,
           total_balance = EXCLUDED.total_balance,
           updated_at = GREATEST(players.updated_at, EXCLUDED.updated_at),
           deleted_at = EXCLUDED.deleted_at,
           delete_description = EXCLUDED.delete_description
         RETURNING id, (xmax = 0) AS inserted`,
        [
          id,
          platformId,
          String(row?.platformName ?? row?.platform_name ?? ""),
          String(row?.playerName ?? row?.player_name ?? ""),
          Number(row?.credit) || 0,
          Number(row?.totalBalance ?? row?.total_balance) || 0,
          createdAt,
          updatedAt,
          row?.deletedAt ? Number(row.deletedAt) : null,
          String(row?.deleteDescription ?? row?.delete_description ?? ""),
        ],
      );
      if (!rows?.length) {
        stats.players.skipped += 1;
        continue;
      }
      if (rows[0].inserted)
        stats.players.inserted += 1;
      else stats.players.updated += 1;
    }

    await client.query(
      `SELECT setval(pg_get_serial_sequence('tag_platforms', 'id'), COALESCE((SELECT MAX(id) FROM tag_platforms), 1))`,
    );
    await client.query(
      `SELECT setval(pg_get_serial_sequence('players', 'id'), COALESCE((SELECT MAX(id) FROM players), 1))`,
    );

    await client.query("COMMIT");
    return {
      ok: true,
      json: {
        tagPlatforms: platformEntries.length,
        players: playerEntries.length,
      },
      ...stats,
    };
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}
