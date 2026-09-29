/** [changmen 扩展] 单笔拒单申请金额修复；默认只读，原始 POST 为唯一证据。 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scaleUsdtToCnyDisplay } from "@changmen/shared/currency";
import { recoverPmSubmissionFromLogs } from "../../../core/integrations/polymarket/submission_snapshot.js";

export function planPmSubmissionRepair(row, player, logs) {
  const raw = row.raw ?? {};
  if (row.provider !== "Polymarket" || String(row.status).toLowerCase() !== "reject"
    || String(raw.pmSide ?? "buy").toLowerCase() !== "buy"
    || Number(raw.pmShares) > 0 || Number(raw.pmAttributedSellShares) > 0
    || Number(row.money) !== 0 || String(row.player_id) !== String(player.id)
    || String(row.user_id) !== String(player.owner_user_id))
    throw new Error("拒绝修复：归属/状态/成交或盈亏字段不符合纯拒单条件");
  const snapshot = recoverPmSubmissionFromLogs(logs, { id: Number(player.id), playerName: player.player_name }, row.order_id);
  if (!snapshot)
    throw new Error("无法唯一恢复原始 BUY POST，拒绝猜测金额");
  const betMoney = scaleUsdtToCnyDisplay(snapshot.stakeUsdc);
  return { betMoney, raw: { ...raw, betMoney, pmStakeUsdc: snapshot.stakeUsdc,
    pmSubmission: snapshot, pmFeeUsdc: 0, reward: 0, money: 0,
    pmSubmissionAmountRepairedAt: Date.now() } };
}

async function main() {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  const orderId = value("--order-id");
  const playerId = Number(value("--player-id"));
  const expected = Number(value("--expected-cny"));
  if (!args.includes("--order-id") || !/^0x[0-9a-f]{64}$/i.test(orderId)
    || !args.includes("--player-id") || !Number.isSafeInteger(playerId) || playerId <= 0
    || !args.includes("--expected-cny") || !Number.isFinite(expected) || expected < 0)
    throw new Error("需提供 --order-id 0x… --player-id N --expected-cny N [--execute]");
  const { initDatabaseUrl, getPgPool } = await import("@changmen/db");
  await initDatabaseUrl();
  const pool = getPgPool();
  if (!pool) throw new Error("数据库不可用");
  const client = await pool.connect();
  try {
    await client.query(args.includes("--execute") ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const { rows } = await client.query(
      `SELECT * FROM orders WHERE order_id=$1 AND player_id=$2${args.includes("--execute") ? " FOR UPDATE" : ""}`,
      [orderId, playerId]);
    if (rows.length !== 1) throw new Error("必须唯一命中目标订单");
    const row = rows[0];
    if (Math.abs(Number(row.bet_money) - expected) > 0.000001)
      throw new Error("金额已变化，与预期不一致，停止修复");
    const players = await client.query("SELECT id, owner_user_id, player_name FROM players WHERE id=$1", [playerId]);
    if (players.rows.length !== 1) throw new Error("账号不存在");
    const logs = await client.query(
      "SELECT title,data FROM user_logs WHERE user_id=$1 AND title LIKE '[Polymarket]%下注 =>%' AND data LIKE $2 ORDER BY create_at DESC LIMIT 21",
      [row.user_id, `%${orderId}%`]);
    const plan = planPmSubmissionRepair(row, players.rows[0], logs.rows);
    console.log(JSON.stringify({ mode: args.includes("--execute") ? "execute" : "dry-run", orderId, playerId,
      oldCny: Number(row.bet_money), newCny: plan.betMoney, stakeUsdc: plan.raw.pmStakeUsdc }));
    if (args.includes("--execute")) {
      const backupDir = path.resolve("server/backend/storage/audits/pm-submission-repair");
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `${orderId}-${Date.now()}.json`);
      fs.writeFileSync(backup, JSON.stringify({ before: row, after: plan }, null, 2), { flag: "wx", mode: 0o600 });
      const update = await client.query("UPDATE orders SET bet_money=$1, raw=$2::jsonb WHERE id=$3 AND bet_money=$4 RETURNING bet_money,raw->>'pmStakeUsdc' AS stake",
        [plan.betMoney, JSON.stringify(plan.raw), row.id, expected]);
      if (update.rowCount !== 1 || Math.abs(Number(update.rows[0].bet_money) - plan.betMoney) > 0.000001)
        throw new Error("写入结果不符合计划，回滚");
      await client.query("COMMIT");
      console.log(`已提交；回滚备份：${backup}`);
    }
    else await client.query("ROLLBACK");
  }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
