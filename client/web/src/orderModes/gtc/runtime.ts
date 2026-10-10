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

export { gtcProgress } from "@/orderModes/gtc/gtcProgressState";
const queues = new Map<string, Promise<unknown>>();
const polls = new Map<string, Promise<GtcExecution>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
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
export async function refreshGtcRecords(): Promise<void> {
  const session = getAuthSessionVersion(); const owner = gtcProgress.owner; const stamp = generation;
  const rows = await listGtc();
  if (!isAuthSessionCurrent(session) || owner !== gtcProgress.owner || stamp !== generation)
    return;
  for (const row of rows) {
    acceptGtc(row);
    if (row.owner !== owner)
      continue;
    const current = currentGtc(row.id);
    markGtcLegOnce(current, "PM");
    markGtcLegOnce(current, "OTHER");
  }
  gtcProgress.ready = true; gtcProgress.error = "";
}
export async function pollGtc(id: string): Promise<GtcExecution> {
  const existing = polls.get(id); if (existing)
    return existing;
  const task = (async () => {
    const row = currentGtc(id);
    if (!row.pmAuthorized || row.submit === "rejected")
      return row;
    const account = useAccountStore().findAccount(row.plan.playerId);
    if (!account)
      throw new Error("GTC 原 PM 账号暂不可用；请勿重复下单");
    const { readGtcFacts } = await import("@changmen/venue-adapter/polymarket/gtc");
    let result: GtcExecution;
    try { result = await mutateGtc(id, { kind: "facts", facts: await readGtcFacts(account, row.plan, row.orderId || row.plan.orderHash, row.createdAt) }); }
    catch (error) {
      result = await mutateGtc(id, { kind: "facts", facts: { order: null, fills: [], complete: false, observedAt: Date.now(), error: error instanceof Error ? error.message : "GTC 核对失败" } });
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
  try {
    await refreshGtcRecords();
    await refreshGtcOrders().catch(() => {});
    if (stamp !== generation)
      return;
    for (const row of [...gtcProgress.records]) {
      if (stamp !== generation)
        break;
      // 旧版未提交记录只修正终态；不授权或发送任何场馆订单。
      if (!row.released && gtcCanFinishWithoutOrders(row)) {
        await mutateGtc(row.id, { kind: "close" });
        continue;
      }
      if (!row.released && row.decision === "open"
        && (row.deadlineAt ? Date.now() > row.deadlineAt : Date.now() - row.createdAt > 10000)) {
        await mutateGtc(row.id, { kind: "close" }).catch(() => {});
      }
      if (!row.released || Date.now() - row.createdAt < 24 * 60 * 60 * 1000)
        await pollGtc(row.id).catch(() => {});
      if (row.decision === "closed" && ["authorized", "accepted", "pending", "filled", "unknown"].includes(row.other.state)
        && (!row.released || Date.now() - row.createdAt < 24 * 60 * 60 * 1000)) {
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
      if (!row.released && row.pmAuthorized && !listeners.has(row.id)) {
        const account = useAccountStore().findAccount(row.plan.playerId);
        if (account) {
          const ws = await import("@changmen/venue-adapter/polymarket");
          if (stamp !== generation)
            return;
          listeners.set(row.id, ws.observePolymarketOrderWatch(account, row.orderId || row.plan.orderHash, () => {
            if (stamp === generation)
              void pollGtc(row.id).catch(() => {});
          }));
        }
      }
    }
  }
  catch (error) {
    if (stamp === generation)
      gtcProgress.error = error instanceof Error ? error.message : "GTC 恢复失败";
  }
  finally {
    if (stamp === generation)
      timer = setTimeout(() => { void tick(stamp); }, 5000);
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
}
/** 复用现有自动下注开启操作；仅解除已终止且核实的人工接管组，不恢复原组编排。 */
export async function resumeGtcAfterManualReview(): Promise<void> {
  await refreshGtcRecords();
  for (const row of [...gtcProgress.records].filter(r => !r.released)) {
    await pollGtc(row.id); await mutateGtc(row.id, { kind: "resume" });
  }
}
