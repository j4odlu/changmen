/**
 * 按 CHANGMEN_DB_SCRIPT 启动后端（仅 rds；兼容 GAMEBET_DB_SCRIPT）。
 * router.js 不入库，须在加载 server 前从 router.ts 编译。
 */
import { ensureRouterCompiled } from "./ensure-router-compiled.mjs";

ensureRouterCompiled({ label: "start-db" });

const { loadChangmenEnv } = await import("@changmen/storage/load_env");
loadChangmenEnv();
process.env.DATABASE_APPLICATION_NAME ||= "changmen-esport";
const {
  DB_SCRIPT_MODES,
  resolveDbScript,
  initDatabaseUrl,
} = await import("@changmen/db");

const raw = String(process.env.CHANGMEN_DB_SCRIPT || process.env.GAMEBET_DB_SCRIPT || "rds").trim().toLowerCase();
const script = resolveDbScript();
if (!DB_SCRIPT_MODES.includes(raw) && raw !== script) {
  console.warn(`[start-db] 未知 CHANGMEN_DB_SCRIPT=${raw}，使用 ${script}`);
}
process.env.CHANGMEN_DB_SCRIPT = script;

console.log(`[start-db] CHANGMEN_DB_SCRIPT=${script}`);

await initDatabaseUrl();

await import("../server.js");
