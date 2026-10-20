#!/usr/bin/env node
/**
 * 一次性：profiles.accounts jsonb → players.account_data + 结构化列
 * 部署 028 之后执行；之后 SaveData 只写 players。
 *
 *   cd changmen/server/backend && node scripts/ops/migrations/migrate-accounts-jsonb-to-players.mjs
 *   node scripts/ops/migrations/migrate-accounts-jsonb-to-players.mjs --dry-run
 */
import "@changmen/storage/load_env.js";
import * as sb from "@changmen/db";
import { mergeJsonbAccountIntoPlayerPatch } from "../../../player_account_record.js";
import { getPgPool } from "../../../rds/common.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const pool = getPgPool();
  if (!pool) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  try {
    const { rows: profiles } = await pool.query(
      `SELECT p.id, p.user_name, p.accounts
       FROM profiles p
       ORDER BY p.user_name`,
    );
    let merged = 0;
    let skipped = 0;
    let missingPlayer = 0;
    for (const p of profiles || []) {
      const uid = String(p.id);
      let accounts = [];
      try {
        accounts = Array.isArray(p.accounts) ? p.accounts : JSON.parse(p.accounts || "[]");
      }
      catch {
        accounts = [];
      }
      if (!accounts.length)
        continue;
      for (const row of accounts) {
        const playerId = Number(row?.accountId ?? row?.AccountId);
        if (!playerId) {
          skipped++;
          continue;
        }
        const player = await sb.fetchPlayerById(playerId);
        if (!player) {
          console.warn(`[migrate] ${p.user_name}: player ${playerId} 不存在，跳过`);
          missingPlayer++;
          continue;
        }
        if (player.ownerUserId && String(player.ownerUserId) !== uid) {
          console.warn(`[migrate] ${p.user_name}: player ${playerId} owner=${player.ownerUserId} 不匹配，跳过`);
          skipped++;
          continue;
        }
        const patch = mergeJsonbAccountIntoPlayerPatch(row, player);
        if (dryRun) {
          console.log(`[dry-run] ${p.user_name} player ${playerId} provider=${patch.provider} cred=${Boolean(patch.accountData?.gateway && patch.accountData?.token)}`);
          merged++;
          continue;
        }
        const ok = await sb.savePlayerAccountRecord(uid, {
          ...row,
          accountId: playerId,
          platformId: patch.platformId ?? player.platformId,
          platformName: patch.platformName || player.platformName,
          playerName: patch.playerName || player.playerName,
          provider: patch.provider,
          credit: patch.credit,
          balance: patch.totalBalance,
          ...patch.accountData,
        });
        if (ok)
          merged++;
        else
          skipped++;
      }
    }
    console.log("[migrate-accounts-jsonb-to-players] done:", {
      dryRun,
      merged,
      skipped,
      missingPlayer,
      profiles: profiles?.length ?? 0,
    });
  }
  finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
