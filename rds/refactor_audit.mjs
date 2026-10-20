import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * P1 重构全面检测 — node rds/refactor_audit.mjs
 */
import * as db from "@changmen/db";
import * as impl from "./impl_rds.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stores = [
  "./rds/auth_store.js",
  "./rds/orders_store.js",
  "./rds/platform_collector_store.js",
  "./rds/client_matches_store.js",
  "./rds/profile_store.js",
  "./rds/money_log_store.js",
  "./rds/player_store.js",
  "./rds/team_store.js",
  "./rds/matcher_store.js",
];

const usedSymbols = [
  "authSignIn",
  "authSignOut",
  "authGetUser",
  "authRefreshToken",
  "isAuthConfigured",
  "fetchProfiles",
  "fetchProfileById",
  "writeProfile",
  "insertProfile",
  "writeAccounts",
  "fetchProfilesAdmin",
  "updateUserName",
  "updateUserIsAdmin",
  "writeUserMetadata",
  "upsertOrders",
  "setOrdersInsertedHook",
  "setOrdersBoundHook",
  "updateOrderBind",
  "fetchOrdersByDate",
  "fetchOrdersByDatePage",
  "fetchOrdersByPlayer",
  "fetchOrdersByPlayerAll",
  "fetchOrdersByPlayerOrderIds",
  "fetchOrdersByLink",
  "fetchOrderByOrderId",
  "fetchUserByName",
  "fetchUserById",
  "fetchOrdersAdminStats",
  "fetchOrdersAdminPage",
  "deleteOrdersByIds",
  "fetchOrdersAdminAll",
  "fetchOrdersForMonthAggregate",
  "fetchOrdersForProfitAggregate",
  "fetchMoneyLogsForMonthAggregate",
  "fetchMoneyLogsByPlayer",
  "fetchMoneyLogById",
  "fetchAllMoneyLogs",
  "upsertMoneyLog",
  "deleteMoneyLogById",
  "deleteMoneyLogsByPlayer",
  "fetchTagPlatforms",
  "upsertTagPlatformByName",
  "insertPlayerRow",
  "fetchPlayerById",
  "fetchPlayersByIds",
  "updatePlayerDisplayName",
  "batchUpdatePlayerDisplayNames",
  "batchSavePlayerAccountRecords",
  "updatePlayerBalanceRow",
  "insertUserLogRow",
  "fetchUserLogsInRange",
  "softDeletePlayerRow",
  "migratePlayersJsonToRds",
  "setPlatformMatchId",
  "writePlatformMatches",
  "fetchPlatformMatches",
  "fetchPlatformBets",
  "fetchLiveTimers",
  "writePlatformBets",
  "replacePlatformBetsForMatch",
  "writeLiveTimers",
  "writeLiveTimersAsync",
  "purgePlatformLiveTimers",
  "writeClientMatches",
  "writeClientMatchesAsync",
  "fetchClientMatches",
  "fetchClientMatchesMeta",
  "initLastWrittenIds",
  "isPbHashOrder",
  "isHashLink",
  "placeholderLinkFromCreateAt",
  "placeholderLinkFromInsertAt",
  "backendBindLinkFromCreateAt",
  "isInsertTimePlaceholderLink",
  "CLIENT_ORDER_LIST_SQL",
  "isClientOrderListVisible",
  "orderVisibleSqlAnd",
  "CHANGMEN_ORDER_LIST_SQL",
  "orderChangmenBetSqlAnd",
  "matchChangmenBetFromLogs",
  "betLogWindowForOrders",
  "isCreateAtPlaceholderLink",
  "isArbBindLink",
  "shouldFireOrderBoundHook",
  "CLIENT_MATCH_LIST_HIDDEN",
  "CLIENT_MATCH_LIST_DEFAULT",
  "archiveStaleRows",
  "formatArchiveCounts",
  "DEFAULT_CLIENT_MATCH_ARCHIVE_INTERVAL_MS",
  "initDatabaseUrl",
  "buildPgClientConfig",
  "ensurePgPoolReady",
  "getPgPool",
  "getResolvedDatabaseLabel",
  "getDbMode",
  "isMatcherStoreReady",
  "getClientMatchIdAdapter",
  "fetchClientMatchRow",
  "setClientMatchListStatus",
  "fetchAllPlatformMatchBindings",
  "fetchPlatformMatchesByClientMatchId",
  "deletePlatformMatchRow",
  "reassignPlatformMatchIds",
  "deleteClientMatchRow",
  "fetchPlatformMatchesHomeAway",
  "fetchPlatformMatchesDebugRows",
  "fetchTeamPlatformMap",
  "countTeamMapsForGbId",
  "reassignGbTeamId",
  "nextManualGbTeamId",
  "updateCanonicalTeamById",
  "insertCanonicalTeam",
  "fetchCanonicalTeamExact",
  "findCanonicalTeamByNormalizedName",
  "upsertTeamPlatformMaps",
  "fetchPlatformMatchRow",
];

const removedSymbols = [
  "getServiceClient",
  "usesRdsImpl",
  "getTeamDbScript",
  "hasAdminAccess",
  "getActiveDbScript",
  "clearClientMatchesOnStartup",
  "updatePlatformMatchMatchId",
];

let failed = 0;
function ok(msg) {
  console.log(`  ✔ ${msg}`);
}
function fail(msg) {
  console.error(`  ✘ ${msg}`);
  failed += 1;
}

console.log("=== 1. store 模块可 import ===");
for (const rel of stores) {
  try {
    await import(rel);
    ok(rel);
  }
  catch (err) {
    fail(`${rel}: ${err.message}`);
  }
}

console.log("\n=== 2. impl_rds ↔ index 导出一致 ===");
const implKeys = Object.keys(impl).sort();
for (const k of implKeys) {
  if (!(k in db))
    fail(`index 缺少 impl 导出: ${k}`);
}
for (const k of implKeys) {
  if (k in db && typeof impl[k] !== typeof db[k] && impl[k] != null && db[k] != null) {
    fail(`类型不一致 ${k}: impl=${typeof impl[k]} index=${typeof db[k]}`);
  }
}
if (failed === 0)
  ok(`${implKeys.length} 个 impl 符号均在 @changmen/db 可用`);

console.log("\n=== 3. 业务侧常用符号 ===");
for (const sym of usedSymbols) {
  if (!(sym in db))
    fail(`@changmen/db 缺少: ${sym}`);
  else if (typeof db[sym] === "undefined")
    fail(`${sym} 为 undefined`);
}
if (failed === 0)
  ok(`${usedSymbols.length} 个业务符号均存在`);

console.log("\n=== 4. 已删除的遗留 / 死 export ===");
for (const sym of removedSymbols) {
  if (sym in db)
    fail(`应已删除但仍存在: ${sym}`);
  else ok(`${sym} 已移除`);
}

console.log("\n=== 5. 废弃文件 ===");
if (fs.existsSync(path.join(__dirname, "db_mode.js")))
  fail("db_mode.js 应已删除");
else ok("db_mode.js 不存在");
for (const legacy of ["team_store.js", "matcher_store.js"]) {
  if (fs.existsSync(path.join(__dirname, legacy)))
    fail(`${legacy} 应已迁入 rds/`);
  else ok(`${legacy} 不在 db 根目录`);
}

console.log("\n=== 6. facade 行数 ===");
const facadeLines = fs.readFileSync(path.join(__dirname, "impl_rds.js"), "utf8").split("\n").length;
ok(`impl_rds.js ${facadeLines} 行`);
if (facadeLines > 120)
  fail(`impl_rds.js 仍偏大 (${facadeLines} 行)`);

console.log("\n=== 7. order_link_filter A8 语义（SQL 返回全量） ===");
const { isOrderListVisible } = db;
const samples = [
  [-1, "RAY", true],
  [1_700_000_000_000, "RAY", true],
  [12345, "RAY", true],
  [12345, "PB", false],
  [0, "OB", true],
];
for (const [link, provider, want] of samples) {
  const got = isOrderListVisible(link, provider);
  if (got !== want)
    fail(`isOrderListVisible(${link}, ${provider}) = ${got}, want ${want}`);
}
ok("LinkID 辅助判断与 A8 一致；读路径 SQL 不过滤");

console.log("\n=== 8. package.json 子路径 export ===");
try {
  await import("@changmen/db/order_link_filter.js");
  ok("@changmen/db/order_link_filter.js 可 import");
}
catch (err) {
  fail(`order_link_filter 子路径: ${err.message}`);
}
try {
  await import("@changmen/storage/paths.js");
  ok("@changmen/storage/paths.js 可 import");
}
catch (err) {
  fail(`storage paths 子路径: ${err.message}`);
}
for (const legacy of ["paths.js", "json_file_store.js", "load_env.js"]) {
  try {
    await import(`@changmen/db/${legacy}`);
    fail(`@changmen/db/${legacy} 应已迁至 @changmen/storage`);
  }
  catch {
    ok(`@changmen/db/${legacy} 不再 export`);
  }
}

console.log(failed ? `\n❌ 检测失败: ${failed} 项` : "\n✅ 全面检测通过");
process.exit(failed ? 1 : 0);
