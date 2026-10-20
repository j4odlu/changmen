/**
 * CHANGMEN_DB_SCRIPT — 仅支持 rds（读写 RDS + pg）。
 * 兼容旧名 GAMEBET_DB_SCRIPT。
 */

export const DB_SCRIPT_MODES = ["rds"];

/** @param {Record<string, string|undefined>} [env] */
export function resolveDbScript(env = process.env) {
  const raw = String(env.CHANGMEN_DB_SCRIPT || env.GAMEBET_DB_SCRIPT || "rds").trim().toLowerCase();
  if (raw === "rds")
    return "rds";
  if (raw === "supabase" || raw === "dual") {
    console.warn(`[db] CHANGMEN_DB_SCRIPT=${raw} 已废弃，使用 rds`);
    return "rds";
  }
  console.warn(`[db] 未知 CHANGMEN_DB_SCRIPT=${raw}，使用 rds`);
  return "rds";
}

/** @returns {{ script: string }} */
export function getDbMode(env = process.env) {
  return { script: resolveDbScript(env) };
}

export function describeDbScript(_script) {
  return "读写 RDS（含队伍表）";
}
