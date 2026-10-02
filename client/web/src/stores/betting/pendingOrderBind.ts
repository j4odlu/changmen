import type { ObservationContext } from "@changmen/shared/order_observation";
import type { PlatformAccount } from "@/models/platformAccount";
import { saveOrderBind } from "@/api/esport";
import { observeOrder } from "@/services/orderObservation";
import { useAccountStore } from "@/stores/accountStore";
import { syncActiveBetBindFailed, syncActiveBetBindSuccess } from "@/stores/betting/activeBetRunSync";
import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";

/** [changmen 扩展] 当场 Bind 重试耗尽后，挂到主循环下一轮再补绑 */
export interface PendingOrderBindItem {
  observation?: ObservationContext;
  target?: string;
  linkId: number;
  provider: string;
  accountId: number;
  orderId: string;
  betId?: number;
  side?: "A" | "B";
  enqueuedAt: number;
  attempts: number;
}

const MAX_QUEUE = 40;
const MAX_DEFERRED_ATTEMPTS = 5;
const ITEM_TTL_MS = 30 * 60 * 1000;

const queue: PendingOrderBindItem[] = [];

function recordBind(item: PendingOrderBindItem, outcome: string, reasonCode?: string): void {
  try {
    observeOrder(item.observation, item.linkId, "bind_result", {
      provider: item.provider,
      accountId: item.accountId,
      orderId: item.orderId,
      target: item.target,
      outcome,
      reasonCode,
      source: reasonCode?.startsWith("deferred_bind_") ? "deferred_bind_api_ack" : "business_bind_queue",
    });
  }
  catch { /* 旁路失败不得改变补绑队列与重试次数 */ }
}

function itemKey(item: Pick<PendingOrderBindItem, "linkId" | "provider" | "orderId">): string {
  return `${item.linkId}|${item.provider}|${item.orderId}`;
}

/** 当场 Bind 失败后入队（同 key 去重，保留较早 enqueuedAt） */
export function enqueuePendingOrderBind(item: Omit<PendingOrderBindItem, "enqueuedAt" | "attempts">): void {
  if (!item.linkId || !item.orderId || !item.provider)
    return;
  const key = itemKey(item);
  if (queue.some(q => itemKey(q) === key))
    return;
  queue.push({
    ...item,
    enqueuedAt: Date.now(),
    attempts: 0,
  });
  while (queue.length > MAX_QUEUE) {
    const dropped = queue.shift();
    if (dropped)
      recordBind(dropped, "failed", "bind_queue_overflow");
  }
}

export function peekPendingOrderBinds(): readonly PendingOrderBindItem[] {
  return queue;
}

export function clearPendingOrderBinds(): void {
  queue.length = 0;
}

async function tryBindOne(item: PendingOrderBindItem): Promise<boolean> {
  const accountStore = useAccountStore();
  const account: PlatformAccount | undefined = accountStore.findAccount(item.accountId);
  const playerId = account?.accountId ?? item.accountId;
  return saveOrderBind({
    orders: JSON.stringify([
      {
        LinkID: item.linkId,
        Provider: item.provider,
        PlayerID: playerId,
        OrderID: item.orderId,
      },
    ]),
  });
}

/**
 * 主循环每轮消费补绑队列。
 * 成功：刷新订单列表；耗尽：进行中订单标「绑单失败（补绑）」。
 */
export async function processPendingOrderBinds(): Promise<{ ok: number; fail: number; left: number }> {
  if (queue.length === 0)
    return { ok: 0, fail: 0, left: 0 };

  const now = Date.now();
  let ok = 0;
  let fail = 0;
  const remain: PendingOrderBindItem[] = [];

  const batch = queue.splice(0, queue.length);
  for (const item of batch) {
    if (now - item.enqueuedAt > ITEM_TTL_MS) {
      recordBind(item, "failed", "bind_expired");
      fail += 1;
      if (item.betId != null && item.side)
        syncActiveBetBindFailed(item.betId, [item.side], `绑单失败（超时）· ${item.provider}`);
      continue;
    }
    item.attempts += 1;
    try {
      const bound = await tryBindOne(item);
      recordBind(item, bound ? "saved" : "failed", "deferred_bind_return");
      if (bound) {
        ok += 1;
        if (item.betId != null && item.side)
          syncActiveBetBindSuccess(item.betId, [item.side], "已绑单");
        continue;
      }
    }
    catch (e) {
      recordBind(item, "unknown", "deferred_bind_exception");
      console.warn("[pendingOrderBind] deferred bind error", item, e);
    }
    if (item.attempts >= MAX_DEFERRED_ATTEMPTS) {
      recordBind(item, "failed", "bind_attempts_exhausted");
      fail += 1;
      if (item.betId != null && item.side) {
        syncActiveBetBindFailed(
          item.betId,
          [item.side],
          `绑单失败（补绑耗尽）· ${item.provider}`,
        );
      }
      continue;
    }
    remain.push(item);
  }

  queue.push(...remain);
  if (ok > 0)
    refreshOrderListAfterBind();
  return { ok, fail, left: queue.length };
}
