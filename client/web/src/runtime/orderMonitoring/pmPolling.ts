/** [changmen 扩展] PM 模块独占 GTC 原挂单核对、撤单和 WS 监听；不查询对侧场馆。 */
import type { GtcCommand, GtcExecution, GtcFacts } from "@changmen/shared/pm_gtc";
import type { GtcTradeHistory } from "@changmen/venue-adapter/polymarket/gtc";
import type { PlatformAccount } from "@/models/platformAccount";
import { gtcCanCancel, gtcPmNeverSubmitted, gtcUnits } from "@changmen/shared/pm_gtc";
import { gtcProgress } from "@/orderModes/gtc/gtcProgressState";
import { gtcPmReconciled } from "@/orderModes/gtc/pollingPolicy";
import { gtcSyncIssue } from "@/orderModes/gtc/syncStatus";
import { useAccountStore } from "@/stores/accountStore";

interface Context {
  current: (id: string) => GtcExecution;
  mutate: (id: string, command: GtcCommand) => Promise<GtcExecution>;
  mark: (row: GtcExecution, leg: "PM") => void;
  captureCurrent: () => () => boolean;
  read?: (account: PlatformAccount, row: GtcExecution, shared?: () => Promise<GtcTradeHistory>) => Promise<GtcFacts>;
}

export function createGtcPmOrderPolling(context: Context) {
  const { current, mutate, mark, captureCurrent } = context;
  const polls = new Map<string, Promise<GtcExecution>>();
  const listeners = new Map<string, () => void>();
  const watches = new Map<string, Promise<void>>();
  const cancellations = new Map<string, Promise<void>>();

  async function poll(id: string, shared?: () => Promise<GtcTradeHistory>): Promise<GtcExecution> {
    const existing = polls.get(id);
    if (existing)
      return existing;
    const isCurrent = captureCurrent();
    const task = (async () => {
      const row = current(id);
      if (!row.pmAuthorized || gtcPmNeverSubmitted(row) || row.submit === "rejected")
        return row;
      const account = useAccountStore().findAccount(row.plan.playerId);
      if (!account)
        throw new Error("GTC 原 PM 账号暂不可用；请勿重复下单");
      const binding = JSON.stringify([account.provider, account.accountId, account.token, account.gateway]);
      const validBinding = () => isCurrent() && binding === JSON.stringify([account.provider, account.accountId, account.token, account.gateway]);
      const { readGtcFacts } = await import("@changmen/venue-adapter/polymarket/gtc");
      let result: GtcExecution;
      try {
        if (!validBinding())
          throw new Error("GTC 会话已变更");
        const facts = context.read ? await context.read(account, row, shared) : await readGtcFacts(account, row.plan, row.orderId || row.plan.orderHash, row.createdAt);
        if (!validBinding())
          throw new Error("GTC 会话已变更");
        result = await mutate(id, { kind: "facts", facts });
        if (isCurrent())
          delete gtcProgress.queryIssues[id];
      }
      catch (error) {
        // 查询失败不是订单事实，不覆写已确认成交/费用，也不重发订单。
        if (isCurrent())
          gtcProgress.queryIssues[id] = gtcSyncIssue(error);
        throw error;
      }
      if (!result.counted && result.complete && gtcUnits(result.matched) > 0n) {
        try { await mutate(id, { kind: "counted" }); }
        catch { /* 服务端只允许一次计数 */ }
      }
      mark(current(id), "PM");
      if (gtcPmReconciled(current(id))) { listeners.get(id)?.(); listeners.delete(id); }
      return current(id);
    })();
    polls.set(id, task);
    try { return await task; }
    finally {
      if (polls.get(id) === task)
        polls.delete(id);
    }
  }

  async function cancel(id: string): Promise<void> {
    const existing = cancellations.get(id);
    if (existing)
      return existing;
    const isCurrent = captureCurrent();
    const task = cancelOriginal(id).finally(() => {
      if (cancellations.get(id) === task)
        cancellations.delete(id);
      if (isCurrent())
        delete gtcProgress.cancelInFlight[id];
    });
    cancellations.set(id, task);
    return task;
  }
  async function cancelOriginal(id: string): Promise<void> {
    const row = current(id);
    if (!gtcCanCancel(row))
      throw new Error("原单当前不可取消");
    const account = useAccountStore().findAccount(row.plan.playerId);
    if (!account || account.provider !== "Polymarket")
      throw new Error("原 PM 账号不可用");
    const commandId = crypto.randomUUID();
    const isCurrent = captureCurrent();
    const binding = JSON.stringify([account.provider, account.accountId, account.token, account.gateway]);
    gtcProgress.cancelInFlight[id] = true;
    // 本地接管立即生效；副本保存不在 PM 撤单的等待链路上。
    const authorized = await mutate(id, { kind: "cancel", commandId });
    const { pmCancelOrder } = await import("@changmen/venue-adapter/polymarket/gtc");
    if (!isCurrent() || binding !== JSON.stringify([account.provider, account.accountId, account.token, account.gateway]))
      throw new Error("用户会话已变更，取消结果需要核实");
    try {
      const result = await pmCancelOrder<{ canceled?: string[]; not_canceled?: Record<string, string> }>(account, authorized.orderId!);
      if (!isCurrent())
        return;
      const rejected = result.not_canceled?.[authorized.orderId!];
      const canceled = result.canceled?.some(orderId => orderId.toLowerCase() === authorized.orderId!.toLowerCase());
      await mutate(id, { kind: "cancel_result", commandId, state: canceled ? "acknowledged" : rejected ? "failed" : "unknown", message: canceled ? "PM 已确认取消剩余挂单，成交明细继续核对" : rejected || "取消结果待核实，可继续查询或重试原单撤单" });
      if (canceled) {
        const latest = current(id);
        await mutate(id, { kind: "facts", facts: { order: { id: authorized.orderId!, original: latest.plan.shares, matched: latest.order?.matched ?? latest.matched, status: "CANCELED", tradeIds: latest.order?.tradeIds ?? [] }, fills: [], complete: false, observedAt: Date.now() } });
      }
    }
    catch (error) {
      if (!isCurrent())
        return;
      await mutate(id, { kind: "cancel_result", commandId, state: "unknown", message: error instanceof Error ? error.message : "取消结果待核实" });
    }
    await poll(id).catch(() => {});
  }

  async function watch(id: string): Promise<void> {
    const existing = watches.get(id);
    if (existing)
      return existing;
    const isCurrent = captureCurrent();
    const task = (async () => {
      const row = current(id);
      if (gtcPmReconciled(row)) {
        listeners.get(id)?.(); listeners.delete(id);
        return;
      }
      if (row.released || !row.pmAuthorized || gtcPmNeverSubmitted(row) || listeners.has(id))
        return;
      const account = useAccountStore().findAccount(row.plan.playerId);
      if (!account)
        return;
      const ws = await import("@changmen/venue-adapter/polymarket");
      if (!isCurrent() || gtcPmReconciled(current(id)))
        return;
      listeners.set(id, ws.observePolymarketOrderWatch(account, row.orderId || row.plan.orderHash, () => {
        if (isCurrent() && !gtcPmReconciled(current(id)))
          void poll(id).catch(() => {});
      }));
    })();
    watches.set(id, task);
    try { await task; }
    finally {
      if (watches.get(id) === task)
        watches.delete(id);
    }
  }

  return { poll, cancel, watch, reset(): void {
    for (const dispose of listeners.values()) dispose();
    listeners.clear(); watches.clear(); polls.clear(); cancellations.clear();
  } };
}
