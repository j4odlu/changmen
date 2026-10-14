import type { GtcExecution } from "@changmen/shared/pm_gtc";
/** [changmen 扩展] 后台发现与财务恢复各自退避，已加载原单的官方查询不等待恢复。 */
import type { GtcRecoverOrders, GtcRecoverSection } from "@changmen/shared/pm_gtc_recovery";
import type { OrderRow } from "@/types/order";
import { GTC_RECOVERY_KNOWN_LIMIT } from "@changmen/shared/pm_gtc_recovery";
import { applyRecoveredGtcRecords, captureGtcSession, financialOrders, gtcProgress, knownGtcRevisions, settlement } from "@/orderModes/gtc/executionState";
import { recoverGtc, resetGtcRecoveryApi } from "@/orderModes/gtc/recoveryApi";
import { financialRecoveryKey, financialResultKey, needsFinancialRecovery, recoveryRetryDelay, unchangedDelay } from "./recoveryPolicy";

interface RecoveryRead { key: string; result?: string; at: number; unchanged: number; failures: number }
const reads = new Map<string, RecoveryRead>();
let pending: Promise<void> | undefined;
let generation = 0;
let discoverAt = 0;
let discoveryFailures = 0;
let discoveryUnchanged = 0;
let discovered = false;
let discoveryIssue = "";
const readIssues = new Map<string, string>();
const recordsKey = () => JSON.stringify(gtcProgress.records.map(row => [row.id, financialRecoveryKey(row)]).sort());

function acceptExecutions(part: GtcRecoverSection<GtcExecution>, before: string): void {
  try {
    if (!part.ok)
      throw new Error(part.message);
    const failures = applyRecoveredGtcRecords(part.rows);
    if (failures)
      throw new Error(`有 ${failures} 条旧 GTC 记录恢复失败`);
    discoveryUnchanged = discovered && before === recordsKey() ? discoveryUnchanged + 1 : 0;
    discovered = true; discoveryFailures = 0; discoveryIssue = "";
    discoverAt = Date.now() + (gtcProgress.records.length ? unchangedDelay(discoveryUnchanged) : 300000);
  }
  catch (error) {
    discoveryIssue = "旧 GTC 列表读取失败，已加载的原单继续独立核对";
    discoverAt = Date.now() + recoveryRetryDelay(++discoveryFailures);
    throw error;
  }
}

function dueReads() {
  const orders = financialOrders();
  return gtcProgress.records.filter((row) => {
    if (!needsFinancialRecovery(row, orders)) {
      reads.delete(row.id); readIssues.delete(row.id);
      return false;
    }
    const read = reads.get(row.id);
    return !read || Date.now() >= read.at || (!read.failures && read.key !== financialRecoveryKey(row));
  }).map(row => ({ id: row.id, key: financialRecoveryKey(row) }));
}
function failedReads(entries: { id: string; key: string }[]): void {
  for (const entry of entries) {
    const previous = reads.get(entry.id);
    const failures = (previous?.failures ?? 0) + 1;
    reads.set(entry.id, { key: entry.key, result: previous?.result, unchanged: previous?.unchanged ?? 0, failures, at: Date.now() + recoveryRetryDelay(failures) });
    readIssues.set(entry.id, "GTC 原单财务副本读取失败，官方查询和撤单继续独立运行");
  }
}
function acceptFinancials(part: GtcRecoverOrders<OrderRow>, requested: { id: string; key: string }[]): void {
  const entries = part.ids.map((id) => {
    const row = gtcProgress.records.find(row => row.id === id);
    return { id, key: requested.find(entry => entry.id === id)?.key ?? (row ? financialRecoveryKey(row) : "") };
  });
  if (!part.ok) {
    failedReads(entries);
    throw new Error(part.message);
  }
  settlement.rows(part.rows);
  for (const entry of entries) {
    const previous = reads.get(entry.id);
    const result = part.unchangedIds.includes(entry.id)
      ? previous!.result!
      : financialResultKey(part.rows.filter(row => row.PmGtcExecutionId === entry.id));
    const unchanged = previous?.key === entry.key && previous.result === result ? previous.unchanged + 1 : 0;
    reads.set(entry.id, { key: entry.key, result, unchanged, failures: 0, at: Date.now() + unchangedDelay(unchanged) });
    readIssues.delete(entry.id);
  }
}

export function recoverMonitorRecords(): Promise<void> {
  if (pending)
    return pending;
  const sessionCurrent = captureGtcSession(); const stamp = generation;
  const isCurrent = () => sessionCurrent() && stamp === generation;
  const task = (async () => {
    const discover = Date.now() >= discoverAt;
    const candidates = dueReads();
    const total = Math.max(candidates.length, discover ? 1 : 0);
    let failure: unknown;
    // 正常一轮只发一个聚合请求；超过 1000 个待恢复原单才分批。
    for (let offset = 0; offset < total; offset += 1000) {
      const batch = candidates.slice(offset, offset + 1000);
      const selected = new Set(batch.map(entry => entry.id));
      const requestDiscovery = discover && offset === 0;
      const before = recordsKey();
      try {
        const response = await recoverGtc({ discover: requestDiscovery, knownRevisions: knownGtcRevisions(GTC_RECOVERY_KNOWN_LIMIT), monitorIds: batch.map(entry => entry.id), recoverDiscovered: requestDiscovery, skipMonitorIds: gtcProgress.records.filter(row => !selected.has(row.id)).map(row => row.id).slice(0, GTC_RECOVERY_KNOWN_LIMIT), knownOrders: Object.fromEntries([...reads].filter(([, read]) => read.result != null)
          .slice(0, GTC_RECOVERY_KNOWN_LIMIT).map(([id, read]) => [id, read.result!])) }, isCurrent);
        if (!isCurrent())
          return;
        if (response.executions) {
          try { acceptExecutions(response.executions, before); }
          catch (error) { failure = error; }
        }
        for (const part of response.orders) {
          try { acceptFinancials(part, batch); }
          catch (error) { failure = error; }
        }
      }
      catch (error) {
        if (!isCurrent())
          throw error;
        if (requestDiscovery) {
          try { acceptExecutions({ ok: false, message: error instanceof Error ? error.message : "GTC 恢复读取失败" }, before); }
          catch { /* transport 失败同时退避本次请求的执行分区 */ }
        }
        failedReads(batch); failure = error;
      }
    }
    gtcProgress.error = discoveryIssue || [...readIssues.values()][0] || "";
    if (failure)
      throw failure;
  })().finally(() => {
    if (pending === task)
      pending = undefined;
  });
  pending = task;
  return task;
}
export function resetMonitorRecovery(): void {
  generation++; pending = undefined; reads.clear(); readIssues.clear();
  resetGtcRecoveryApi();
  discoverAt = 0; discoveryFailures = 0; discoveryUnchanged = 0; discovered = false; discoveryIssue = "";
}
