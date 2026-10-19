import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { getAuthSessionVersion, isAuthSessionCurrent, post, unwrap } from "@/api/client";
import { useUserStore } from "@/stores/userStore";
import { useAccountStore } from "@/stores/accountStore";
import { prepareLocalGtcPlan } from "./localPlan";
import { createLocalGtc, finishLocalGtcMigration, importLocalGtc, listLocalGtc, localGtcMigrationDone, mutateLocalGtc } from "./localStore";

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
export async function createGtc(id: string, maker: string, plan: GtcPlan): Promise<GtcExecution> {
  const userId = owner(); const session = getAuthSessionVersion();
  const prepared = prepareLocalGtcPlan(plan);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error("GTC 执行 ID 无效");
  const accounts = useAccountStore();
  const account = accounts.findAccount(prepared.playerId);
  if (!account || account.provider !== "Polymarket" || accounts.adminWorkspacePreview) throw new Error("PM 账号身份无效");
  if (prepared.source !== "manual" && accounts.findAccount(prepared.otherPlayerId)?.provider !== prepared.otherProvider)
    throw new Error("GTC 对侧账号身份不一致");
  const { pmSubmitMaker } = await import("@changmen/venue-browser/adapter/polymarket");
  const wallet = pmSubmitMaker(account).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || maker.toLowerCase() !== wallet) throw new Error("GTC 客户端与钱包不一致");
  if (!isAuthSessionCurrent(session) || owner() !== userId) throw new Error("GTC 会话已变更");
  return createLocalGtc(userId, id, wallet, prepared);
}
export async function commandGtc(row: GtcExecution, command: GtcCommand): Promise<GtcExecution> {
  const userId = owner();
  if (row.owner !== userId) throw new Error("GTC 执行归属无效");
  return mutateLocalGtc(userId, row.id, row.revision, command);
}
