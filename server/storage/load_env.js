/**
 * 在连接 RDS 或读写 storage 之前加载 changmen .env。
 * 默认读 server/backend/.env；matcher 可 prepend server/match/matcher/.env。
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { CHANGMEN_ROOT_FROM_PKG } from "./changmen_root.js";

function hasDatabaseUrl() {
  return !!(
    process.env.DATABASE_URL ||
    process.env.DATABASE_URL_PUBLIC ||
    process.env.DATABASE_URL_INTERNAL
  );
}

/**
 * pm2 restart --update-env 可能把 `PREDICT_FUN_API_KEY=`（空串）写进进程环境；
 * dotenv 默认不覆盖「已存在」的 key，空串会挡住 .env 里的真值 → PF house 误报未配置。
 * 在读文件前清掉空串占位，让 .env 能灌进来。
 */
function clearEmptyEnvPlaceholders() {
  for (const key of Object.keys(process.env)) {
    // Explicitly empty alternatives must stay empty: otherwise dotenv can silently
    // redirect a script with a local DATABASE_URL to a configured remote database.
    if (process.env[key] === "" && !/^DATABASE_URL(?:_PUBLIC|_INTERNAL)?$/.test(key))
      delete process.env[key];
  }
}

/** @param {{ prepend?: string[] }} [options] */
export function loadChangmenEnv(options = {}) {
  clearEmptyEnvPlaceholders();
  const rels = [...(options.prepend ?? []), "server/backend/.env"];
  for (const rel of rels) {
    const envPath = path.join(CHANGMEN_ROOT_FROM_PKG, rel);
    if (!fs.existsSync(envPath)) continue;
    dotenv.config({ path: envPath });
    if (hasDatabaseUrl()) break;
  }
}
