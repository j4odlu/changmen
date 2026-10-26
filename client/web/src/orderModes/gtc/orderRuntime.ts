import type { GtcOrderRecord, GtcOrderCommand, GtcOrderContext } from "./core/orderRecord";
import type { GtcOrderPlan } from "@changmen/shared/pm_gtc_order";
import type { GtcTradeHistory } from "@changmen/venue-browser/adapter/polymarket/gtc";
import { canCancelGtcOrder, gtcOrderNeverSubmitted } from "@changmen/shared/pm_gtc_order";
import { watch } from "vue";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useAccountStore } from "@/stores/accountStore";
import { createOrderMonitorLoop } from "@/runtime/orderMonitoring/loop";
import { applyGtcOrderCommand, gtcOrderReconciled } from "./core/orderRecord";
import { createStoredGtcOrder, listStoredGtcOrders, mutateStoredGtcOrder } from "./orderStore";
import { gtcOrders } from "./orderState";
import { gtcSyncIssue } from "./syncStatus";
import { clone, localGtcChanges } from "./storage";
import { rememberGtcOrderReference } from "./executionProjection";

const pending = new Map<string, GtcOrderCommand[]>();
const writes = new Map<string, Promise<void>>();
const dispatches = new Set<string>();
const polls = new Map<string, Promise<GtcOrderRecord>>();
const cancellations = new Map<string, Promise<void>>();
const listeners = new Map<string, () => void>();
const watches = new Map<string, Promise<void>>();
let generation = 0;
let stopChanges: (() => void) | undefined;
let recovery: Promise<void> | undefined;
const journalKey = (owner: string) => `PM_GTC_ORDER_V2_COPIES:${owner}`;
const capture = () => {
  const stamp = generation; const owner = gtcOrders.owner; const session = getAuthSessionVersion();
  return () => generation === stamp && owner === gtcOrders.owner && isAuthSessionCurrent(session);
};
export function currentGtcOrder(id: string): GtcOrderRecord {
  const row = gtcOrders.records.find(row => row.id === id && row.owner === gtcOrders.owner);
  if (!row) throw new Error("GTC 原单尚未恢复");
  return row;
}
function publish(row: GtcOrderRecord): void {
  if (row.owner !== gtcOrders.owner) return;
  rememberGtcOrderReference(row.id, row.owner, row.accountId, row.orderId, row.plan.orderHash);
  const index = gtcOrders.records.findIndex(entry => entry.id === row.id);
  if (index < 0) gtcOrders.records.unshift(row); else gtcOrders.records[index] = row;
}
function journal(): void {
  if (!gtcOrders.owner) return;
  try {
    if (pending.size) sessionStorage.setItem(journalKey(gtcOrders.owner), JSON.stringify([...pending]));
    else sessionStorage.removeItem(journalKey(gtcOrders.owner));
  }
  catch { /* 原授权已持久化；会话副本失败时刷新仍只查询原签单哈希。 */ }
}
function project(row: GtcOrderRecord): GtcOrderRecord {
  let next = clone(row);
  for (const command of pending.get(row.id) ?? []) {
    try { next = applyGtcOrderCommand(next, command); }
    catch { /* 已被其它页面确认的意图不覆盖更新的原单事实。 */ }
  }
  next.revision = row.revision;
  return next;
}
export function flushGtcOrder(id: string): Promise<void> {
  const existing = writes.get(id);
  if (existing) return existing;
  const isCurrent = capture(); const owner = gtcOrders.owner;
  const task = (async () => {
    while (isCurrent() && pending.get(id)?.length) {
      const row = (await listStoredGtcOrders(owner)).find(row => row.id === id);
      if (!isCurrent()) return;
      if (!row) throw new Error("GTC 原单持久记录尚未恢复");
      const command = pending.get(id)![0]!;
      // 旧撤单回执不能覆盖其它页面新发起的撤单。
      const staleCancel = command.kind === "cancel_result" && row.cancel?.commandId !== command.commandId;
      const next = staleCancel ? row : await mutateStoredGtcOrder(owner, id, row.revision, command);
      if (!isCurrent()) return;
      pending.get(id)!.shift();
      if (!pending.get(id)!.length) pending.delete(id);
      publish(project(next)); delete gtcOrders.saveIssues[id]; journal();
    }
  })().catch(error => {
    if (isCurrent()) { gtcOrders.saveIssues[id] = gtcSyncIssue(error); journal(); }
    throw error;
  }).finally(() => { if (writes.get(id) === task) writes.delete(id); });
  writes.set(id, task); return task;
}
export async function changeGtcOrder(id: string, command: GtcOrderCommand): Promise<GtcOrderRecord> {
  const isCurrent = capture(); const owner = gtcOrders.owner;
  if (command.kind === "authorize") {
    await flushGtcOrder(id);
    if (!isCurrent() || pending.has(id)) throw new Error("GTC 发送许可需要当前会话和可用的客户端持久化");
    applyGtcOrderCommand(clone(currentGtcOrder(id)), command);
    const row = await mutateStoredGtcOrder(owner, id, currentGtcOrder(id).revision, command);
    if (!isCurrent()) throw new Error("GTC 会话已变更，禁止发送");
    publish(row); return currentGtcOrder(id);
  }
  const next = applyGtcOrderCommand(clone(currentGtcOrder(id)), command);
  next.revision = currentGtcOrder(id).revision;
  const copies = pending.get(id) ?? [];
  copies.push(clone(command)); pending.set(id, copies);
  publish(next); journal();
  // 订单事实立即展示；副本写入失败只重试保存，不再次买入或吃掉已确认回执。
  await flushGtcOrder(id).catch(() => {});
  if (!isCurrent()) throw new Error("GTC 会话已变更");
  return currentGtcOrder(id);
}
export async function createGtcOrder(id: string, accountId: number, maker: string, plan: GtcOrderPlan, context: GtcOrderContext): Promise<GtcOrderRecord> {
  const isCurrent = capture(); dispatches.add(id);
  try {
    const row = await createStoredGtcOrder(id, gtcOrders.owner, accountId, maker, plan, context);
    if (!isCurrent()) throw new Error("GTC 会话已变更");
    publish(row); return row;
  }
  catch (error) { dispatches.delete(id); throw error; }
}
export async function closeGtcOrderSubmission(id: string): Promise<void> {
  try { await changeGtcOrder(id, { kind: "close" }); }
  finally { dispatches.delete(id); }
}
export function recoverGtcOrders(): Promise<void> {
  if (recovery) return recovery;
  const isCurrent = capture(); const owner = gtcOrders.owner;
  const task = (async () => {
    const rows = await listStoredGtcOrders(owner);
    if (!isCurrent()) return;
    for (const row of rows) {
      if (dispatches.has(row.id)) continue;
      publish(project(row));
      if (!row.submissionClosed) await changeGtcOrder(row.id, { kind: "close" });
      if (!isCurrent()) return;
    }
    gtcOrders.ready = true; gtcOrders.error = "";
  })().catch(error => { if (isCurrent()) gtcOrders.error = error instanceof Error ? error.message : "GTC 原单恢复失败"; })
    .finally(() => { if (recovery === task) recovery = undefined; });
  recovery = task; return task;
}
const accountBinding = (account: ReturnType<ReturnType<typeof useAccountStore>["findAccount"]>) => account
  ? JSON.stringify([account.accountId, account.provider, account.token, account.gateway]) : "";
export function pollGtcOrder(id: string, history?: () => Promise<GtcTradeHistory>): Promise<GtcOrderRecord> {
  const existing = polls.get(id); if (existing) return existing;
  const isCurrent = capture();
  const task = (async () => {
    const row = clone(currentGtcOrder(id));
    if (!row.pmAuthorized || gtcOrderNeverSubmitted(row) || row.submit === "rejected") return row;
    const account = useAccountStore().findAccount(row.accountId);
    if (!account || account.provider !== "Polymarket") throw new Error("GTC 原 PM 账号暂不可用，请勿重复下单");
    const binding = accountBinding(account);
    const valid = () => isCurrent() && binding === accountBinding(account) && binding === accountBinding(useAccountStore().findAccount(row.accountId));
    const api = await import("@changmen/venue-browser/adapter/polymarket/gtc");
    if (!valid()) throw new Error("GTC 会话或原账号已变更");
    const facts = await api.readGtcFacts(account, row.plan, row.orderId || row.plan.orderHash, row.createdAt, history?.());
    if (!valid()) throw new Error("GTC 会话或原账号已变更");
    const next = await changeGtcOrder(id, { kind: "facts", facts });
    if (!valid()) throw new Error("GTC 会话或原账号已变更");
    delete gtcOrders.queryIssues[id];
    if (gtcOrderReconciled(next)) { listeners.get(id)?.(); listeners.delete(id); }
    return next;
  })().catch(error => { if (isCurrent()) gtcOrders.queryIssues[id] = gtcSyncIssue(error); throw error; })
    .finally(() => { if (polls.get(id) === task) polls.delete(id); });
  polls.set(id, task); return task;
}
export function cancelNativeGtcOrder(id: string): Promise<void> {
  const existing = cancellations.get(id); if (existing) return existing;
  const isCurrent = capture();
  const task = (async () => {
    const row = currentGtcOrder(id);
    if (!canCancelGtcOrder(row)) throw new Error("原单当前不可取消");
    const account = useAccountStore().findAccount(row.accountId);
    if (!account || account.provider !== "Polymarket") throw new Error("原 PM 账号不可用");
    const binding = accountBinding(account);
    const valid = () => isCurrent() && binding === accountBinding(account) && binding === accountBinding(useAccountStore().findAccount(row.accountId));
    const commandId = crypto.randomUUID(); gtcOrders.cancelInFlight[id] = true;
    const original = await changeGtcOrder(id, { kind: "cancel", commandId });
    const { pmCancelOrder } = await import("@changmen/venue-browser/adapter/polymarket/gtc");
    if (!valid()) throw new Error("GTC 会话或原账号已变更");
    try {
      const result = await pmCancelOrder<{ canceled?: string[]; not_canceled?: Record<string, string> }>(account, original.orderId!);
      if (!valid()) return;
      const canceled = result.canceled?.some(value => value.toLowerCase() === original.orderId!.toLowerCase());
      const rejected = result.not_canceled?.[original.orderId!];
      await changeGtcOrder(id, { kind: "cancel_result", commandId, state: canceled ? "acknowledged" : rejected ? "failed" : "unknown",
        message: canceled ? "PM 已确认取消剩余挂单，成交明细继续核对" : rejected || "取消结果待核实" });
      if (canceled) {
        const latest = currentGtcOrder(id);
        await changeGtcOrder(id, { kind: "facts", facts: { order: { id: original.orderId!, original: latest.plan.shares,
          matched: latest.order?.matched ?? latest.matched, status: "CANCELED", tradeIds: latest.order?.tradeIds ?? [] },
          fills: [], complete: false, observedAt: Date.now() } });
      }
    }
    catch (error) {
      if (valid()) await changeGtcOrder(id, { kind: "cancel_result", commandId, state: "unknown", message: error instanceof Error ? error.message : "取消结果待核实" });
    }
    if (valid()) await pollGtcOrder(id).catch(() => {});
  })().finally(() => {
    if (cancellations.get(id) === task) cancellations.delete(id);
    if (isCurrent()) delete gtcOrders.cancelInFlight[id];
  });
  cancellations.set(id, task); return task;
}
function watchOrder(id: string): Promise<void> {
  const existing = watches.get(id); if (existing) return existing;
  const isCurrent = capture();
  const task = (async () => {
    const row = currentGtcOrder(id);
    if (gtcOrderReconciled(row) || !row.pmAuthorized || gtcOrderNeverSubmitted(row) || listeners.has(id)) return;
    const account = useAccountStore().findAccount(row.accountId); if (!account) return;
    const api = await import("@changmen/venue-browser/adapter/polymarket");
    if (!isCurrent() || listeners.has(id) || gtcOrderReconciled(currentGtcOrder(id))) return;
    listeners.set(id, api.observePolymarketOrderWatch(account, row.orderId || row.plan.orderHash,
      () => { if (isCurrent()) void pollGtcOrder(id).catch(() => {}); }));
  })().finally(() => { if (watches.get(id) === task) watches.delete(id); });
  watches.set(id, task); return task;
}
const loop = createOrderMonitorLoop({
  recover: recoverGtcOrders,
  active: () => !gtcOrders.ready || pending.size > 0 || gtcOrders.records.some(row => !gtcOrderReconciled(row)),
  tick() {
    for (const id of pending.keys()) void flushGtcOrder(id).catch(() => {});
    const histories = new Map<number, Promise<GtcTradeHistory>>(); const isCurrent = capture();
    for (const row of [...gtcOrders.records]) {
      if (dispatches.has(row.id) || gtcOrderReconciled(row)) continue;
      void pollGtcOrder(row.id, () => {
        let history = histories.get(row.accountId);
        if (!history) {
          const since = Math.min(...gtcOrders.records.filter(entry => entry.accountId === row.accountId && !gtcOrderReconciled(entry)).map(entry => entry.createdAt));
          history = import("@changmen/venue-browser/adapter/polymarket/gtc").then(api => {
            const account = useAccountStore().findAccount(row.accountId);
            if (!isCurrent() || !account) throw new Error("GTC 会话或原账号已变更");
            return api.readGtcTradeHistory(account, since);
          });
          histories.set(row.accountId, history); void history.catch(() => {});
        }
        return history;
      }).catch(() => {});
      void watchOrder(row.id).catch(() => {});
    }
  },
});
export function startNativeGtcOrders(owner: string): void {
  if (gtcOrders.owner === owner) return;
  stopNativeGtcOrders(); gtcOrders.owner = owner;
  try {
    for (const [id, commands] of JSON.parse(sessionStorage.getItem(journalKey(owner)) || "[]") as [string, GtcOrderCommand[]][]) {
      if (typeof id === "string" && Array.isArray(commands) && commands.every(command => command.kind !== "authorize")) pending.set(id, commands);
    }
  }
  catch { /* 损坏副本由持久原单及 PM 重新核对，不创建新订单。 */ }
  stopChanges = watch(() => localGtcChanges.revision, () => { void recoverGtcOrders(); });
  loop.start();
}
export function stopNativeGtcOrders(): void {
  journal(); generation++; loop.stop(); stopChanges?.(); stopChanges = undefined;
  for (const dispose of listeners.values()) dispose();
  listeners.clear(); watches.clear(); writes.clear(); pending.clear(); dispatches.clear(); polls.clear(); cancellations.clear(); recovery = undefined;
  gtcOrders.owner = ""; gtcOrders.ready = false; gtcOrders.records = []; gtcOrders.queryIssues = {}; gtcOrders.saveIssues = {}; gtcOrders.resultIssues = {}; gtcOrders.cancelInFlight = {}; gtcOrders.error = "";
}
