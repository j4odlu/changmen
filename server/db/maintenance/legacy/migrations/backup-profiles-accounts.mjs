#!/usr/bin/env node
/**
 * 部署前备份 players 账号快照（含 account_data；profiles.accounts 已弃写）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";
import { ensurePgPoolReady, getPgPool } from "@changmen/db";
import { playerRowToAccountRecord } from "../../../player_account_record.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "../../../../backend");
const outArg = process.argv.find((a, i) => process.argv[i - 1] === "--out");
const outPath = outArg
  || join(backendRoot, "storage", "backups", `players-accounts-${Date.now()}.json`);

loadChangmenEnv();
await ensurePgPoolReady();
const pool = getPgPool();

const { rows: players } = await pool.query(
  `SELECT pl.*, u.user_name
   FROM players pl
   JOIN profiles p ON p.id = pl.owner_user_id
   JOIN users u ON u.id = p.id
   WHERE pl.deleted_at IS NULL
   ORDER BY u.user_name, pl.id`,
);

const { rows: playerStats } = await pool.query(
  `SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL) AS active,
          COUNT(*) FILTER (WHERE deleted_at IS NULL AND owner_user_id IS NULL) AS active_no_owner
   FROM players`,
);

const byUser = new Map();
for (const row of players) {
  const uid = String(row.owner_user_id);
  if (!byUser.has(uid)) {
    byUser.set(uid, {
      userName: row.user_name,
      id: uid,
      accounts: [],
    });
  }
  const mapped = {
    id: Number(row.id),
    owner_user_id: uid,
    platform_id: Number(row.platform_id),
    platform_name: row.platform_name,
    player_name: row.player_name,
    provider: row.provider,
    credit: row.credit,
    total_balance: row.total_balance,
    account_data: row.account_data,
    wire: playerRowToAccountRecord({
      id: row.id,
      platformId: row.platform_id,
      platformName: row.platform_name,
      playerName: row.player_name,
      provider: row.provider,
      credit: row.credit,
      totalBalance: row.total_balance,
      accountData: row.account_data,
      updatedAt: row.updated_at,
    }),
  };
  byUser.get(uid).accounts.push(mapped);
}

const payload = {
  backedUpAt: new Date().toISOString(),
  playerStats: playerStats[0],
  users: [...byUser.values()],
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
console.log(`[backup] wrote ${outPath} (${players.length} active players, ${byUser.size} users)`);
if ((playerStats[0]?.active_no_owner ?? 0) > 0) {
  console.warn(`[backup] WARN: ${playerStats[0].active_no_owner} active players without owner_user_id`);
  process.exit(1);
}
