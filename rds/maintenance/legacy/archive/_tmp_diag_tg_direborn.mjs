import {
  isCreateAtPlaceholderLink,
  isPbHashOrder,
  shouldFireOrderBoundHook,
} from "@changmen/db";
import { loadChangmenEnv } from "@changmen/storage/load_env.js";

loadChangmenEnv();

const { getPgPool } = await import("@changmen/db");

const pool = getPgPool();
const { rows: users } = await pool.query(
  `SELECT id, user_name FROM users WHERE user_name = 'gb12'`,
);
const userId = users[0].id;

const prof = await pool.query(`SELECT preferences, user_name FROM profiles WHERE id = $1::uuid`, [
  userId,
]);
const prefs = prof.rows[0]?.preferences || {};
const msg = prefs.message || prefs.Message || {};
console.log("gb12 message config:", JSON.stringify(msg, null, 2));

const orders = await pool.query(
  `SELECT order_id, provider, link, create_at, match, bet, item, bet_money, odds
   FROM orders WHERE user_id = $1
     AND (match ILIKE '%Direborn%' AND match ILIKE '%Mentality%')
   ORDER BY create_at DESC LIMIT 5`,
  [userId],
);

const now = Date.now();
const maxAge = (Number(process.env.TELEGRAM_ORDER_NOTIFY_MAX_AGE_MIN) || 120) * 60 * 1000;

console.log("\nenv admin notify:", {
  TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID || "(empty)",
  TELEGRAM_ADMIN_NOTIFY: process.env.TELEGRAM_ADMIN_NOTIFY ?? "1",
  TELEGRAM_ORDER_NOTIFY: process.env.TELEGRAM_ORDER_NOTIFY ?? "1",
});

for (const r of orders.rows) {
  const ca = Number(r.create_at);
  const link = Number(r.link);
  const ageOk = ca >= now - maxAge;
  const pbHash = isPbHashOrder(link, r.provider);
  const placeholder = isCreateAtPlaceholderLink(link, ca) || link === ca - 1;
  const wouldAdminNotifyNow = !pbHash && ageOk;
  const boundHook = shouldFireOrderBoundHook(
    { link: ca - 1, create_at: ca },
    1781933188462,
  );
  console.log("\norder:", {
    provider: r.provider,
    order_id: String(r.order_id).slice(0, 24),
    link: String(r.link),
    create_at: String(r.create_at),
    placeholder,
    ageOk,
    wouldAdminNotifyNow,
    boundHookWouldFire: boundHook,
    wouldNotifyOnBindNow: boundHook && ageOk,
    match: r.match,
    bet: r.bet,
    item: r.item,
  });
}

await pool.end();
