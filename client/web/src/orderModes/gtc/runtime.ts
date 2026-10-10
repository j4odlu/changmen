/** [changmen 扩展] 页面级原单核对；生命周期与订单筛选、组件挂载无关。 */
import type { GtcCommand, GtcExecution } from "@changmen/shared/pm_gtc";
import { gtcCanCancel, gtcCanFinishWithoutOrders, gtcUnits } from "@changmen/shared/pm_gtc";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { gtcOrderProjection, rememberGtcOrderIdentity, resetGtcOrderProjection } from "@/orderModes/gtc/executionProjection";
import { gtcProgress } from "@/orderModes/gtc/gtcProgressState";
import { useAccountStore } from "@/stores/accountStore";
import { useUserStore } from "@/stores/userStore";
import { commandGtc, listGtc } from "./api";
import { refreshGtcOrders } from "./ordersApi";

import { findGtcOtherOrder } from "./otherFacts";
import { readGtcOtherOrders } from "./otherOrders";
import { markGtcSuccess } from "./successMarkers";
import { gtcExecutionDormant, gtcNeedsOtherPolling, gtcPmReconciled } from "./pollingPolicy";
import { gtcSyncIssue } from "./syncStatus";

export { gtcProgress } from "@/orderModes/gtc/gtcProgressState";
const queues = new Map<string, Promise<unknown>>();
const polls = new Map<string, Promise<GtcExecution>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let dormantTimer = false;
const listeners = new Map<string, () => void>();
export function gtcActivated(): boolean {
  const user = useUserStore();
  return user.extensionPrefs.pmArbOrderMode === "GTC" && user.extensionPrefs.pmGtcV1Activation === `1:${user.userId}`;
}
export function acceptGtc(row: GtcExecution): GtcExecution {
  if (row.owner !== gtcProgress.owner)
    return row;
  rememberGtcOrderIdentity(row);
  const index = gtcProgress.records.findIndex(r => r.id === row.id);
  if (index < 0)
    gtcProgress.records.unshift(row);
  else if (gtcProgress.records[index]!.revision <= row.revision)
    gtcProgress.records[index] = row;
  if (timer && dormantTimer && !gtcExecutionDormant(row, gtcOrderProjection.rows)) {
    clearTimeout(timer); dormantTimer = false;
    const stamp = generation;
    timer = setTimeout(() => { void tick(stamp); }, 5000);
  }
  return row;
}
export function currentGtc(id: string): GtcExecution {
  const row = gtcProgress.records.find(r => r.id === id);
  if (!row)
    throw new Error("GTC 记录尚未恢复"); return row;
}
/** [changmen 扩展] 从持久化成交恢复独立 GTC 历史；旧 V1 混合计次键不阻止恢复。 */
export function markGtcLegOnce(row: GtcExecution, leg: "PM" | "OTHER"): void {
  if (String(useUserStore().userId) !== row.owner)
    return;
  const key = `PM_GTC_V2_COUNT:${row.owner}:${row.id}:${leg}`;
  if (sessionStorage.getItem(key))
    return;
  const account = useAccountStore().findAccount(leg === "PM" ? row.plan.playerId : row.plan.otherPlayerId);
  if (!account)
    return;
  if (leg === "PM" && (!row.complete || gtcUnits(row.matched) <= 0n || row.fee == null))
    return;
  if (leg === "OTHER" && row.other.state !== "filled")
    return;
  markGtcSuccess(row.owner, account.accountId, row.plan.betRowId, leg === "PM" ? row.plan.target : row.plan.otherTarget, leg === "PM" ? Number(row.matched) / (Number(row.principal) + Number(row.fee)) : row.plan.otherOdds);
  sessionStorage.setItem(key, "1");
}
export async function mutateGtc(id: string, command: GtcCommand): Promise<GtcExecution> {
  const session = getAuthSessionVersion(); const runGeneration = generation;
  const prior = queues.get(id) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(async () => {
    if (!isAuthSessionCurrent(session) || generation !== runGeneration)
      throw new Error("GTC 会话已变更");
    const row = await commandGtc(currentGtc(id), command);
    if (!isAuthSessionCurrent(session) || generation !== runGeneration)
      throw new Error("GTC 会话已变更");
    return acceptGtc(row);
  });
  queues.set(id, next);
  try { return await next; }
  finally {
    if (queues.get(id) === next)
      queues.delete(id);
  }
}
export async function refreshGtcRecords(betRowId?: number, playerIds?: readonly number[]): Promise<void> {
  const session = getAuthSessionVersion(); const owner = gtcProgress.owner; const stamp = generation;
  let rows: GtcExecution[];
  try { rows = await listGtc(betRowId); }
  catch (error) {
    if (betRowId != null)
      throw new Error("GTC 本盘口成交历史恢复失败");
    throw error;
  }
  if (!isAuthSessionCurrent(session) || owner !== gtcProgress.owner || stamp !== generation)
    return;
  let failures = 0;
  for (const row of rows) {
    if (row.owner !== owner || (betRowId != null && row.plan?.betRowId !== betRowId))
      continue;
    const needsPm = !playerIds || playerIds.includes(row.plan?.playerId);
    const needsOther = !playerIds || playerIds.includes(row.plan?.otherPlayerId);
    if (!needsPm && !needsOther)
      continue;
    try {
      acceptGtc(row);
      const current = currentGtc(row.id);
      if (needsPm)
        markGtcLegOnce(current, "PM");
      if (needsOther)
        markGtcLegOnce(current, "OTHER");
    }
    catch {
      // [changmen 扩展] 一张旧单的本地恢复失败不能中断其它原单；同盘口规则不能静默跳过。
      if (betRowId != null)
        throw new Error("GTC 本盘口成交历史恢复失败");
      failures++;
    }
  }
  if (betRowId == null) {
    gtcProgress.ready = true;
    gtcProgress.recoveredAt = Date.now();
    for (const [id, issue] of Object.entries(gtcProgress.queryIssues)) {
      if (issue.kind === "auth") delete gtcProgress.queryIssues[id];
    }
    gtcProgress.error = failures ? `有 ${failures} 条旧 GTC 记录恢复失败，其他订单继续独立核对` : "";
  }
}
export async function pollGtc(id: string): Promise<GtcExecution> {
  const existing = polls.get(id); if (existing)
    return existing;
  const task = (async () => {
    const stamp = generation; const session = getAuthSessionVersion();
    const row = currentGtc(id);
    if (!row.pmAuthorized || row.submit === "rejected")
      return row;
    const account = useAccountStore().findAccount(row.plan.playerId);
    if (!account)
      throw new Error("GTC 原 PM 账号暂不可用；请勿重复下单");
    const { readGtcFacts } = await import("@changmen/venue-adapter/polymarket/gtc");
    let result: GtcExecution;
    try {
      const facts = await readGtcFacts(account, row.plan, row.orderId || row.plan.orderHash, row.createdAt);
      if (stamp !== generation || !isAuthSessionCurrent(session)) throw new Error("GTC 会话已变更");
      result = await mutateGtc(id, { kind: "facts", facts });
      if (stamp === generation) delete gtcProgress.queryIssues[id];
    }
    catch (error) {
      // 查询/保存失败不是订单事实，不向数据库写空事实，不覆写 accepted/complete/费用或释放状态。
      if (stamp === generation && isAuthSessionCurrent(session)) gtcProgress.queryIssues[id] = gtcSyncIssue(error);
      throw error;
    }
    if (!result.counted && result.complete && gtcUnits(result.matched) > 0n) {
      try {
        await mutateGtc(id, { kind: "counted" });
      }
      catch { /* 服务端只允许一次计数，其他窗口不会重复计数 */ }
    }
    markGtcLegOnce(currentGtc(id), "PM");
    return currentGtc(id);
  })();
  polls.set(id, task);
  try { return await task; }
  finally {
    if (polls.get(id) === task)
      polls.delete(id);
  }
}
export async function cancelGtc(id: string): Promise<void> {
  const row = currentGtc(id); if (!gtcCanCancel(row))
    throw new Error("原单当前不可取消");
  const account = useAccountStore().findAccount(row.plan.playerId);
  if (!account || account.provider !== "Polymarket")
    throw new Error("原 PM 账号不可用");
  const commandId = crypto.randomUUID();
  const session = getAuthSessionVersion();
  // 先持久化人工接管再发送；其他窗口第二腿授权会原子失败。
  const authorized = await mutateGtc(id, { kind: "cancel", commandId });
  const { pmCancelOrder } = await import("@changmen/venue-adapter/polymarket/gtc");
  if (!isAuthSessionCurrent(session))
    throw new Error("用户会话已变更，取消结果需要核实");
  try {
    const result = await pmCancelOrder<{ canceled?: string[]; not_canceled?: Record<string, string> }>(account, authorized.orderId!);
    const rejected = result.not_canceled?.[authorized.orderId!];
    await mutateGtc(id, { kind: "cancel_result", commandId, state: rejected ? "failed" : "unknown", message: rejected || "取消请求已返回，正在核对余量与并发成交" });
  }
  catch (error) {
    await mutateGtc(id, { kind: "cancel_result", commandId, state: "unknown", message: error instanceof Error ? error.message : "取消结果待核实" });
  }
  await pollGtc(id);
}
async function tick(stamp: number): Promise<void> {
  if (stamp !== generation)
    return;
  timer = undefined; dormantTimer = false;
  try {
    await refreshGtcRecords().catch(() => {
      if (stamp === generation)
        gtcProgress.error = "旧 GTC 列表读取失败，已加载的原单继续独立核对";
    });
    await refreshGtcOrders().catch(() => {});
    if (stamp !== generation)
      return;
    for (const row of [...gtcProgress.records]) {
      if (stamp !== generation)
        break;
      try {
        // 旧版未提交记录只修正终态；不授权或发送任何场馆订单。
        if (!row.released && gtcCanFinishWithoutOrders(row)) {
          await mutateGtc(row.id, { kind: "close" });
          continue;
        }
        if (!row.released && row.decision === "open"
          && (row.deadlineAt ? Date.now() > row.deadlineAt : Date.now() - row.createdAt > 10000)) {
          await mutateGtc(row.id, { kind: "close" }).catch(() => {});
        }
        if (!gtcPmReconciled(currentGtc(row.id)) || gtcProgress.queryIssues[row.id])
          await pollGtc(row.id).catch(() => {});
        if (row.decision === "closed" && ["authorized", "accepted", "pending", "filled", "unknown"].includes(row.other.state)
          && gtcNeedsOtherPolling(currentGtc(row.id), gtcOrderProjection.rows)) {
          try {
            const account = useAccountStore().findAccount(row.plan.otherPlayerId);
            if (account) {
              const orders = await readGtcOtherOrders(account, currentGtc(row.id));
              const original = findGtcOtherOrder(currentGtc(row.id), orders ?? []);
              const state = !original ? "unknown" : ["reject", "return"].includes(original.status) ? "rejected" : original.status === "pending" ? "pending" : "filled";
              if (state !== currentGtc(row.id).other.state || (original?.orderId && !row.other.orderId))
                await mutateGtc(row.id, { kind: "other", state, orderId: original?.orderId, message: state === "unknown" ? "对侧原单暂未唯一核实，请人工核对" : "" });
              markGtcLegOnce(currentGtc(row.id), "OTHER");
            }
          }
          catch { /* 查失败不推断拒单、不重发 */ }
        }
        if (gtcPmReconciled(currentGtc(row.id))) {
          listeners.get(row.id)?.(); listeners.delete(row.id);
        }
        else if (!row.released && row.pmAuthorized && !listeners.has(row.id)) {
          const account = useAccountStore().findAccount(row.plan.playerId);
          if (account) {
            const ws = await import("@changmen/venue-adapter/polymarket");
            if (stamp !== generation)
              return;
            listeners.set(row.id, ws.observePolymarketOrderWatch(account, row.orderId || row.plan.orderHash, () => {
              if (stamp === generation && !gtcPmReconciled(currentGtc(row.id)))
                void pollGtc(row.id).catch(() => {});
            }));
          }
        }
      }
      catch {
        if (stamp === generation)
          gtcProgress.error = "有旧 GTC 原单核对失败，其他订单继续独立核对";
      }
    }
  }
  catch (error) {
    if (stamp === generation)
      gtcProgress.error = error instanceof Error ? error.message : "GTC 恢复失败";
  }
  finally {
    if (stamp === generation) {
      dormantTimer = gtcProgress.ready && gtcProgress.records.every(row => !gtcProgress.queryIssues[row.id] && gtcExecutionDormant(row, gtcOrderProjection.rows));
      timer = setTimeout(() => { void tick(stamp); }, dormantTimer ? 60000 : 5000);
    }
  }
}
export function startGtcRuntime(owner: string): void {
  if (gtcProgress.owner === owner)
    return;
  // 已加载的同用户财务订单是恢复依据；启动核对不能清掉它们。
  resetRuntime(gtcOrderProjection.owner === owner); gtcProgress.owner = owner;
  void tick(generation);
}
export function stopGtcRuntime(): void {
  resetRuntime(false);
}
function resetRuntime(preserveProjection: boolean): void {
  if (!preserveProjection) {
    resetGtcOrderProjection();
  }
  generation++; if (timer)
    clearTimeout(timer); timer = undefined;
  for (const dispose of listeners.values()) dispose(); listeners.clear();
  polls.clear(); queues.clear(); gtcProgress.owner = ""; gtcProgress.records = []; gtcProgress.ready = false; gtcProgress.error = "";
  gtcProgress.queryIssues = {}; gtcProgress.recoveredAt = 0;
  dormantTimer = false;
}
/** [changmen 扩展] 兼容旧记录人工确认；只修订旧组，新执行和配置保存不依赖此操作。 */
export async function resumeGtcAfterManualReview(): Promise<void> {
  await refreshGtcRecords();
  for (const row of [...gtcProgress.records].filter(r => !r.released)) {
    await pollGtc(row.id); await mutateGtc(row.id, { kind: "resume" });
  }
}
