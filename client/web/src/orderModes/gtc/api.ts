import type { GtcCommand, GtcExecution } from "@changmen/shared/pm_gtc";
import { getAuthSessionVersion, isAuthSessionCurrent, post, unwrap } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { finishLocalGtcMigration, importLocalGtc, listLocalGtc, localGtcMigrationDone, mutateLocalGtc } from "./localStore";

const migrations = new Map<string, Promise<void>>();
const migrationRetries = new Map<string, { failures: number; at: number }>();
function owner(): string {
  const user = useUserStore();
  if (!user.userId || user.isLoggedIn === false) throw new Error("请先登录");
  return String(user.userId);
}
/** [changmen 扩展] 旧 RDS 执行只读导入一次；新执行和后续控制状态不再写入服务端。 */
async function migrateLegacyRecords(userId: string): Promise<void> {
  if ((migrationRetries.get(userId)?.at ?? 0) > Date.now()) return;
  if (await localGtcMigrationDone(userId)) return;
  const existing = migrations.get(userId);
  if (existing) return existing;
  const session = getAuthSessionVersion();
  const task = (async () => {
    const rows = unwrap(await post<GtcExecution[]>("Pm_GtcList", { clientImport: true }));
    if (!isAuthSessionCurrent(session) || owner() !== userId) throw new Error("GTC 历史导入会话已变更");
    if (!Array.isArray(rows)) throw new Error("GTC 历史执行响应无效");
    await importLocalGtc(userId, rows); await finishLocalGtcMigration(userId);
  })();
  migrations.set(userId, task);
  try { await task; migrationRetries.delete(userId); }
  catch (error) {
    const failures = (migrationRetries.get(userId)?.failures ?? 0) + 1;
    migrationRetries.set(userId, { failures, at: Date.now() + Math.min(60000, 5000 * 2 ** Math.min(failures - 1, 4)) });
    throw error;
  }
  finally { if (migrations.get(userId) === task) migrations.delete(userId); }
}

export async function listGtc(betRowId?: number, knownRevisions?: Record<string, number>): Promise<GtcExecution[]> {
  const userId = owner();
  if (betRowId != null && !await localGtcMigrationDone(userId)) {
    // 原 noSameBet/计次准入必须拿到完整旧历史；后台已知原单监控不等待此导入。
    await migrateLegacyRecords(userId);
    if (!await localGtcMigrationDone(userId)) throw new Error("GTC 本盘口旧成交历史尚未恢复");
  }
  else void migrateLegacyRecords(userId).catch(error => console.warn("[GTC] 旧执行只读导入失败", error));
  const rows = await listLocalGtc(userId);
  return rows.filter(row => (betRowId == null || row.plan.betRowId === betRowId)
    && (!knownRevisions || knownRevisions[row.id] !== row.revision));
}
export async function commandGtc(row: GtcExecution, command: GtcCommand): Promise<GtcExecution> {
  const userId = owner();
  if (command.kind === "authorize_pm" || command.kind === "authorize_other")
    throw new Error("旧 GTC 记录只允许查询和撤单，禁止重发或新增发送");
  if (row.owner !== userId) throw new Error("GTC 执行归属无效");
  return mutateLocalGtc(userId, row.id, row.revision, command);
}
