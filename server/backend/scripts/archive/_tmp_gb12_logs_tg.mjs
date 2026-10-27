import { loadChangmenEnv } from "@changmen/storage/load_env";
import { handleSendMessage } from "../core/esport-api/telegram_send.js";

loadChangmenEnv();

const { getPgPool } = await import("@changmen/db");
const pool = getPgPool();
const { rows: u } = await pool.query(`SELECT id FROM users WHERE user_name = 'gb12'`);
const uid = u[0].id;

const t0 = 1781933188000 - 10 * 60_000;
const t1 = 1781933188544 + 10 * 60_000;
const logs = await pool.query(
  `SELECT title, create_at, data::text AS data FROM user_logs
   WHERE user_id = $1::uuid AND create_at >= $2 AND create_at <= $3
   ORDER BY create_at`,
  [uid, t0, t1],
);
console.log("user_logs around bet:", logs.rows.length);
for (const r of logs.rows) {
  const t = new Date(Number(r.create_at)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const preview = (r.data || "").slice(0, 180).replace(/\n/g, " ");
  console.log(`[${t}] ${r.title}: ${preview}`);
}

// Test user telegram (dry - only if --send flag)
if (process.argv.includes("--send")) {
  const userChat = "7957197543";
  const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
  for (const [label, chat] of [
    ["user", userChat],
    ["admin", adminChat],
  ]) {
    const res = await handleSendMessage({
      chat_id: chat,
      text: `<b>诊断测试</b> gb12 Direborn 通知链路 ${label}`,
      parse_mode: "HTML",
    });
    console.log(`send ${label} (${chat}):`, res);
  }
}

const cd = await pool.query(
  `SELECT key, value FROM client_data WHERE user_id = $1::uuid`,
  [uid],
);
console.log("\nclient_data keys:", cd.rows.map(r => r.key));
const msgRow = cd.rows.find(r => r.key === "Message" || r.key === "message");
console.log("Message client_data:", msgRow?.value);

await pool.end();
