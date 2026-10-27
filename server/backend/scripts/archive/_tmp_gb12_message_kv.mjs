import { loadChangmenEnv } from "@changmen/storage/load_env";
import * as accountService from "../core/account/account_service.js";
import * as store from "../core/esport-api/store.js";

loadChangmenEnv();

const { getPgPool } = await import("@changmen/db");
const pool = getPgPool();
const { rows } = await pool.query(`SELECT id FROM users WHERE user_name = 'gb12'`);
const uid = rows[0].id;

const prof = await pool.query(`SELECT preferences FROM profiles WHERE id = $1::uuid`, [uid]);
const prefs = prof.rows[0]?.preferences || {};
console.log("preferences.Message type:", typeof prefs.Message, prefs.Message?.slice?.(0, 120));
console.log("preferences.message type:", typeof prefs.message, String(prefs.message || "").slice(0, 120));

const raw = store.getUserSetting(uid, "Message");
console.log("getUserSetting Message:", raw?.slice?.(0, 200));

const data = accountService.handleGetData("Message", uid);
console.log("handleGetData Message direct:", data.direct);

await pool.end();
