import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();

const { getPgPool } = await import("@changmen/db");
const pool = getPgPool();

for (const name of ["gb12", "sz01"]) {
  const { rows: u } = await pool.query(`SELECT id FROM users WHERE user_name = $1`, [name]);
  if (!u.length) {
    console.log(name, "not found");
    continue;
  }
  const prof = await pool.query(`SELECT preferences FROM profiles WHERE id = $1::uuid`, [u[0].id]);
  const prefs = prof.rows[0]?.preferences || {};
  let msg = prefs.Message ?? prefs.message ?? null;
  if (typeof msg === "string") {
    try {
      msg = JSON.parse(msg);
    }
    catch {
      /* keep string */
    }
  }
  console.log(`\n${name}:`, {
    telegramId: msg?.telegramId ?? "(empty)",
    notifyArbProgress: msg?.notifyArbProgress,
    pushOrderId: msg?.pushOrderId ?? "(empty)",
  });
}

console.log("\nserver .env:", {
  TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID || "(empty)",
  TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
});

await pool.end();
