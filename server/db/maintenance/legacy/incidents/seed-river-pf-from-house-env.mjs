/**
 * River：只保留一个活跃 PredictFun 账号，token 写入主号 predictAccount（无私钥）。
 * Privy 由本机 Vite `VITE_PREDICT_FUN_PRIVY_PRIVATE_KEY` 注入（见 configure 配套步骤），不上 RDS。
 *
 * Usage (from server/backend):
 *   node scripts/ops/incidents/seed-river-pf-from-house-env.mjs
 *   node scripts/ops/incidents/seed-river-pf-from-house-env.mjs --apply
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env" });

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL_PUBLIC || process.env.DATABASE_URL || process.env.DATABASE_URL_INTERNAL;
if (!url) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const predictAccount = String(process.env.PREDICT_FUN_PREDICT_ACCOUNT || "").trim();
const hasPrivy = Boolean(String(process.env.PREDICT_FUN_PRIVY_PRIVATE_KEY || "").trim());
if (!/^0x[0-9a-fA-F]{40}$/.test(predictAccount)) {
  console.error("PREDICT_FUN_PREDICT_ACCOUNT 无效或未配置");
  process.exit(1);
}
if (!hasPrivy)
  console.warn("警告：.env 无 PREDICT_FUN_PRIVY_PRIVATE_KEY；请同步到 client/web/.env.local 的 VITE_ 变量");

const persistToken = JSON.stringify({ predictAccount });
const pool = new pg.Pool({
  connectionString: url,
  ssl: /sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined,
});

function mergeAccountDataToken(accountData, tokenJson, predictAccount) {
  const data
    = accountData && typeof accountData === "object" && !Array.isArray(accountData)
      ? { ...accountData }
      : {};
  data.token = tokenJson;
  data.currency = "USDT";
  data.venueMemberId = predictAccount;
  data.venueAccountName = predictAccount;
  delete data.balance;
  delete data.Balance;
  delete data.mode;
  delete data.house;
  return data;
}

async function main() {
  const users = await pool.query(
    `SELECT u.id, u.user_name FROM users u WHERE u.user_name ILIKE 'river' LIMIT 1`,
  );
  if (!users.rows.length)
    throw new Error("找不到用户 River");
  const userId = String(users.rows[0].id);
  const userName = String(users.rows[0].user_name);
  console.log(`user=${userName} id=${userId}`);
  console.log(`predictAccount=${predictAccount}`);
  console.log(`mode=${apply ? "APPLY" : "DRY-RUN"}`);

  const pl = await pool.query(
    `SELECT id, player_name, total_balance, account_data, provider, platform_name, deleted_at
     FROM players
     WHERE owner_user_id = $1::uuid
       AND (provider ILIKE '%predict%' OR platform_name ILIKE '%predict%')
     ORDER BY id ASC`,
    [userId],
  );
  const allPf = pl.rows.map((r) => ({
    id: Number(r.id),
    playerName: String(r.player_name || userName),
    totalBalance: Number(r.total_balance) || 0,
    accountData: r.account_data,
    deleted: r.deleted_at != null,
  }));
  const active = allPf.filter((r) => !r.deleted);
  if (!active.length && !allPf.length)
    throw new Error("River 尚无 PredictFun players 行；请先在 UI 新建 PredictFun 账号后再跑");

  // 保留：优先已有活跃行；多个则留 id 最大的一条
  let keep = active.sort((a, b) => b.id - a.id)[0] || null;
  if (!keep) {
    // 全部已删：复活 id 最大的一条
    keep = allPf.slice().sort((a, b) => b.id - a.id)[0];
    console.log(`will undelete player id=${keep.id}`);
  }
  const dropIds = active.filter((r) => r.id !== keep.id).map((r) => r.id);
  console.log(`keep PF accountId=${keep.id} total_balance=${keep.totalBalance}`);
  if (dropIds.length)
    console.log(`soft-delete extra PF ids=${dropIds.join(",")}`);

  const nextData = mergeAccountDataToken(keep.accountData, persistToken, predictAccount);
  const venueAccountKey = `predictfun:member:${predictAccount}`;

  const prof = await pool.query(`SELECT accounts FROM profiles WHERE id = $1`, [userId]);
  /** @type {any[]} */
  const prevAccounts = Array.isArray(prof.rows[0]?.accounts) ? [...prof.rows[0].accounts] : [];
  const nonPf = prevAccounts.filter(
    (a) => String(a?.provider ?? a?.Provider ?? "").trim() !== "PredictFun",
  );
  const pfRow = {
    accountId: keep.id,
    provider: "PredictFun",
    platformName: "PredictFun",
    playerName: predictAccount,
    token: persistToken,
    credit: 0,
    currency: "USDT",
    pause: false,
    venueMemberId: predictAccount,
    venueAccountName: predictAccount,
  };
  const nextAccounts = [...nonPf, pfRow];

  if (!apply) {
    console.log("dry-run ok；加 --apply 写入 players + profiles.accounts");
    return;
  }

  const now = Date.now();
  if (keep.deleted) {
    await pool.query(
      `UPDATE players
       SET deleted_at = NULL, delete_description = NULL, updated_at = $2
       WHERE id = $1 AND owner_user_id = $3::uuid`,
      [keep.id, now, userId],
    );
  }

  await pool.query(
    `UPDATE players
     SET provider = 'PredictFun',
         platform_name = 'PredictFun',
         player_name = $5,
         venue_member_id = $6,
         venue_account_key = $7,
         account_data = $3::jsonb,
         credit = 0,
         updated_at = $4
     WHERE id = $1 AND owner_user_id = $2::uuid`,
    [keep.id, userId, JSON.stringify(nextData), now, predictAccount, predictAccount, venueAccountKey],
  );

  if (dropIds.length) {
    await pool.query(
      `UPDATE players
       SET deleted_at = $2, delete_description = $3, updated_at = $2
       WHERE owner_user_id = $1::uuid AND id = ANY($4::bigint[]) AND deleted_at IS NULL`,
      [userId, now, "River 仅保留一个 PF 测试账号", dropIds],
    );
  }

  await pool.query(`UPDATE profiles SET accounts = $2::jsonb WHERE id = $1`, [
    userId,
    JSON.stringify(nextAccounts),
  ]);

  console.log(`applied: sole PF accountId=${keep.id}`);
  console.log("Privy：请确保 client/web/.env.local 有 VITE_PREDICT_FUN_PRIVY_PRIVATE_KEY + VITE_PREDICT_FUN_PREDICT_ACCOUNT（与 backend .env 主号一致），硬刷新后再刷余额");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
