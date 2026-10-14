/** [changmen 扩展] 官方状态立即采用；执行授权与后台结果副本分别串行化。 */
import type { GtcCommand, GtcExecution, GtcFacts } from "@changmen/shared/pm_gtc";
import { applyGtcCommand, gtcUnits, mergeGtcFacts } from "@changmen/shared/pm_gtc";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { commandGtc, listGtc } from "./api";
import { gtcCopyKey } from "./copyKey";
import { gtcOrderProjection, rememberGtcOrderIdentity, resetGtcOrderProjection } from "./executionProjection";
import { gtcProgress } from "./gtcProgressState";
import { createGtcSettlementEvidence } from "./settlementEvidence";
import { markGtcSuccess } from "./successMarkers";
import { gtcSyncIssue } from "./syncStatus";

export { gtcProgress } from "./gtcProgressState";
const queues = new Map<string, Promise<unknown>>();
const persisted = new Map<string, GtcExecution>();
const copies = new Map<string, GtcCommand[]>();
const official = new Map<string, GtcFacts>();
const reloadBeforeRetry = new Set<string>();
interface CopyRetry { failures: number; at: number }
const retries = new Map<string, CopyRetry>();
const inFlightCopies = new Map<string, GtcCommand>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const journalKey = (owner: string) => `PM_GTC_RESULT_COPIES:${owner}`;

function journal(): void {
  if (!gtcProgress.owner)
    return;
  try {
    const entries = [...copies].map(([id, commands]) => ({ row: persisted.get(id), commands, facts: official.get(id), retry: retries.get(id) }));
    if (entries.length)
      sessionStorage.setItem(journalKey(gtcProgress.owner), JSON.stringify(entries));
    else sessionStorage.removeItem(journalKey(gtcProgress.owner));
  }
  catch { /* 存储不可用不改变官方结果；本会话仍保留内存副本。 */ }
}
function project(row: GtcExecution, includeOfficial = true): GtcExecution {
  let result = clone(row);
  const facts = includeOfficial ? official.get(row.id) : undefined;
  if (facts)
    result = mergeGtcFacts(result, facts);
  for (const command of copies.get(row.id) ?? []) {
    try { result = applyGtcCommand(result, command, Date.now()); }
    catch { /* 已持久化或已被更新的本地意图，不覆盖官方事实。 */ }
  }
  result.revision = row.revision;
  return result;
}
function publish(row: GtcExecution): GtcExecution {
  rememberGtcOrderIdentity(row);
  const index = gtcProgress.records.findIndex(r => r.id === row.id);
  if (index < 0)
    gtcProgress.records.unshift(row);
  else gtcProgress.records[index] = row;
  return row;
}
function scheduleRetry(): void {
  clearTimeout(retryTimer); retryTimer = undefined;
  const pending = [...copies.keys()].filter(id => !queues.has(id));
  if (!pending.length)
    return;
  const at = Math.min(...pending.map(id => retries.get(id)?.at ?? Date.now()));
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    for (const id of copies.keys()) {
      if ((retries.get(id)?.at ?? 0) <= Date.now())
        void flushGtcCopies(id).catch(() => {});
    }
  }, Math.max(0, at - Date.now()));
}
function alreadySaved(row: GtcExecution, command: GtcCommand): boolean {
  return (command.kind === "counted" && row.counted)
    || (command.kind === "cancel" && (row.terminal || row.cancel?.commandId === command.commandId))
    || (command.kind === "cancel_result" && row.cancel?.commandId !== command.commandId)
    || gtcCopyKey(row) === gtcCopyKey(applyGtcCommand(clone(row), command, Date.now()));
}
function urgentCopy(command: GtcCommand): boolean {
  return ["ack", "other", "cancel", "cancel_result"].includes(command.kind);
}
/** [changmen 扩展] 官方结果立即采用；后台副本按执行串行重试，授权仍须持久化成功。 */
export function flushGtcCopies(id: string, immediate = false): Promise<void> {
  const prior = queues.get(id);
  if (prior)
    return prior.then(() => {}, () => {});
  if (!copies.has(id))
    return Promise.resolve();
  if (!immediate && (retries.get(id)?.at ?? 0) > Date.now()) {
    scheduleRetry(); return Promise.resolve();
  }
  const isCurrent = captureGtcSession();
  const task = (async () => {
    try {
      if (reloadBeforeRetry.has(id)) {
        const row = currentGtc(id);
        const rows = await listGtc(row.plan.betRowId);
        if (!isCurrent())
          return;
        const latest = rows.find(r => r.id === id && r.owner === row.owner);
        if (!latest)
          throw new Error("GTC 执行副本尚未恢复");
        acceptGtc(latest); reloadBeforeRetry.delete(id);
      }
      while (isCurrent() && copies.get(id)?.length) {
        const command = copies.get(id)![0]!;
        const base = persisted.get(id)!;
        if (!alreadySaved(base, command)) {
          inFlightCopies.set(id, command);
          let saved: GtcExecution;
          try { saved = await commandGtc(base, command); }
          finally {
            if (inFlightCopies.get(id) === command)
              inFlightCopies.delete(id);
          }
          if (!isCurrent())
            return;
          persisted.set(id, clone(saved));
          retries.delete(id);
        }
        copies.get(id)!.shift();
        if (!copies.get(id)!.length)
          copies.delete(id);
        publish(project(persisted.get(id)!)); journal();
      }
      if (isCurrent()) {
        retries.delete(id);
        delete gtcProgress.saveIssues[id];
      }
    }
    catch (error) {
      if (isCurrent()) {
        reloadBeforeRetry.add(id);
        const failures = Math.min(5, (retries.get(id)?.failures ?? 0) + 1);
        retries.set(id, { failures, at: Date.now() + Math.min(60000, 5000 * 2 ** (failures - 1)) });
        gtcProgress.saveIssues[id] = gtcSyncIssue(error);
        journal();
      }
      throw error;
    }
  })();
  queues.set(id, task);
  void task.finally(() => {
    if (queues.get(id) === task)
      queues.delete(id);
    if (isCurrent())
      scheduleRetry();
  }).catch(() => {});
  return task;
}
export const settlement = createGtcSettlementEvidence();
let generation = 0;
export function captureGtcSession(): () => boolean {
  const stamp = generation; const session = getAuthSessionVersion();
  return () => stamp === generation && isAuthSessionCurrent(session);
}
export function financialOrders() {
  return settlement.rows([...useOrderStore().orders.values()].flat());
}
export function gtcActivated(): boolean {
  const user = useUserStore();
  return user.extensionPrefs.pmArbOrderMode === "GTC" && user.extensionPrefs.pmGtcV1Activation === `1:${user.userId}`;
}
export function acceptGtc(row: GtcExecution): GtcExecution {
  if (row.owner !== gtcProgress.owner)
    return row;
  const previous = persisted.get(row.id);
  if (previous && previous.revision > row.revision)
    return currentGtc(row.id);
  persisted.set(row.id, clone(row));
  return publish(project(row));
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
  command = clone(command);
  if (command.kind !== "authorize_pm" && command.kind !== "authorize_other") {
    const previous = currentGtc(id);
    if (command.kind === "cancel_result" && previous.cancel?.commandId !== command.commandId)
      return previous;
    if (!persisted.has(id))
      persisted.set(id, clone(previous));
    const row = applyGtcCommand(clone(previous), command, Date.now());
    row.revision = previous.revision;
    if (command.kind === "facts") {
      const facts: GtcFacts = { order: clone(row.order), fills: clone(Object.values(row.fills)), complete: row.complete, observedAt: row.observedAt, ...(row.error ? { error: row.error } : {}) };
      official.set(id, facts);
      command = { ...command, facts };
    }
    // 本地核对时间始终更新；相同的已保存/待保存内容不再产生写请求。
    const target = project(persisted.get(id)!, false);
    if (gtcCopyKey(target) === gtcCopyKey(row)) {
      publish(row);
      if (copies.has(id))
        journal();
      return row;
    }
    const pending = copies.get(id) ?? [];
    const last = pending[pending.length - 1];
    // 仅合并尚未发送的连续事实，保留成交明细；不会改动正在发送的副本。
    if (command.kind === "facts" && last?.kind === "facts" && inFlightCopies.get(id) !== last)
      pending[pending.length - 1] = { ...command, facts: official.get(id)! };
    else pending.push(clone(command));
    if (urgentCopy(command)) {
      // 已发送副本不动；回执/撤单等事件优先于尚未发送的轮询副本，事件之间保持顺序。
      const offset = pending[0] === inFlightCopies.get(id) ? 1 : 0;
      const remaining = pending.splice(offset);
      pending.push(...remaining.filter(urgentCopy), ...remaining.filter(entry => !urgentCopy(entry)));
    }
    copies.set(id, pending); publish(row); journal();
    void flushGtcCopies(id, command.kind !== "facts").catch(() => {});
    return row;
  }
  const session = getAuthSessionVersion(); const runGeneration = generation;
  await flushGtcCopies(id, true);
  if (copies.has(id))
    throw new Error("GTC 执行授权需要可用的持久化；官方订单状态仍保留");
  const prior = queues.get(id) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(async () => {
    if (!isAuthSessionCurrent(session) || generation !== runGeneration)
      throw new Error("GTC 会话已变更");
    // 本地关闭/取消意图仍参与准入；不把后台副本版本当成新的发送授权。
    applyGtcCommand(clone(currentGtc(id)), command, Date.now());
    const row = await commandGtc(persisted.get(id) ?? currentGtc(id), command);
    if (!isAuthSessionCurrent(session) || generation !== runGeneration)
      throw new Error("GTC 会话已变更");
    return acceptGtc(row);
  });
  queues.set(id, next);
  try { return await next; }
  finally {
    if (queues.get(id) === next)
      queues.delete(id);
    if (isAuthSessionCurrent(session) && generation === runGeneration)
      scheduleRetry();
  }
}
export function knownGtcRevisions(limit = 1000): Record<string, number> {
  return Object.fromEntries([...persisted.values()].filter(row => row.owner === gtcProgress.owner
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id))
    .slice(0, limit).map(row => [row.id, row.revision]));
}
export async function refreshGtcRecords(betRowId?: number, playerIds?: readonly number[]): Promise<void> {
  const session = getAuthSessionVersion(); const owner = gtcProgress.owner; const stamp = generation;
  let rows: GtcExecution[];
  try {
    // 后台发现只读取新执行/新副本版本；盘口计次与失败重试仍读取完整所需记录。
    const known = knownGtcRevisions();
    rows = betRowId == null && Object.keys(known).length ? await listGtc(undefined, known) : await listGtc(betRowId);
  }
  catch (error) {
    if (betRowId != null)
      throw new Error("GTC 本盘口成交历史恢复失败");
    throw error;
  }
  if (!isAuthSessionCurrent(session) || owner !== gtcProgress.owner || stamp !== generation)
    return;
  applyRecoveredGtcRecords(rows, betRowId, playerIds);
}
/** [changmen 扩展] 聚合恢复与旧盘口读取复用接纳逻辑，不再次发起列表请求。 */
export function applyRecoveredGtcRecords(rows: GtcExecution[], betRowId?: number, playerIds?: readonly number[]): number {
  const owner = gtcProgress.owner;
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
      if (issue.kind === "auth")
        delete gtcProgress.queryIssues[id];
    }
    gtcProgress.error = failures ? `有 ${failures} 条旧 GTC 记录恢复失败，其他订单继续独立核对` : "";
  }
  return failures;
}

export function initializeGtcState(owner: string): boolean {
  if (gtcProgress.owner === owner)
    return false;
  resetGtcState(gtcOrderProjection.owner === owner);
  gtcProgress.owner = owner;
  try {
    const entries = JSON.parse(sessionStorage.getItem(journalKey(owner)) || "[]") as { row: GtcExecution; commands: GtcCommand[]; facts?: GtcFacts; retry?: CopyRetry }[];
    for (const entry of entries) {
      if (!entry.row || entry.row.owner !== owner || !Array.isArray(entry.commands))
        continue;
      copies.set(entry.row.id, entry.commands);
      if (entry.facts)
        official.set(entry.row.id, entry.facts);
      const retry = entry.retry;
      if (retry && Number.isSafeInteger(retry.failures) && retry.failures > 0 && retry.failures <= 5 && Number.isFinite(retry.at))
        retries.set(entry.row.id, retry);
      else retries.set(entry.row.id, { failures: 0, at: Date.now() + 5000 });
      reloadBeforeRetry.add(entry.row.id); acceptGtc(entry.row);
      gtcProgress.saveIssues[entry.row.id] = gtcSyncIssue("官方结果副本等待后台同步");
    }
    scheduleRetry();
  }
  catch { /* 损坏的本地副本不阻止从后台和官方恢复。 */ }
  return true;
}
export function resetGtcState(preserveProjection = false): void {
  if (!preserveProjection)
    resetGtcOrderProjection();
  generation++; queues.clear(); settlement.reset();
  clearTimeout(retryTimer); retryTimer = undefined;
  persisted.clear(); copies.clear(); official.clear(); reloadBeforeRetry.clear(); retries.clear(); inFlightCopies.clear();
  gtcProgress.owner = ""; gtcProgress.records = []; gtcProgress.ready = false; gtcProgress.error = "";
  gtcProgress.queryIssues = {}; gtcProgress.otherQueryIssues = {}; gtcProgress.recoveredAt = 0;
  gtcProgress.saveIssues = {}; gtcProgress.cancelInFlight = {};
}
