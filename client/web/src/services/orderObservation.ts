import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ObservationContext, ObservationKind, OrderObservationEvent } from "@changmen/shared/order_observation";
import type { PlatformAccount } from "@/models/platformAccount";
import { normalizeObservationEvent } from "@changmen/shared/order_observation";
import { getAuthSessionVersion, isAuthSessionCurrent, isAuthTransitionPending } from "@/api/client";
import { useOrderObservationStore } from "@/stores/orderObservationStore";
import { useUserStore } from "@/stores/userStore";
import { OrderObservationOutbox } from "./orderObservationOutbox";
import { uploadObservationBatch } from "./orderObservationTransport";

let outbox: OrderObservationOutbox | undefined;
const STORAGE_KEY = "changmen:order-observation:v1";

function currentOwner(): string {
  try {
    const user = useUserStore();
    return user.isLoggedIn && isAuthSessionCurrent(getAuthSessionVersion()) && !isAuthTransitionPending() ? String(user.userId || "") : "";
  }
  catch { return ""; }
}

/** 在运行时安装阶段调用；不在下注路径初始化持久化队列。 */
export function startOrderObservation(): void {
  try {
    outbox ??= new OrderObservationOutbox({
      owner: currentOwner,
      read: () => sessionStorage.getItem(STORAGE_KEY),
      write: value => sessionStorage.setItem(STORAGE_KEY, value),
      send: (ownerUserId, events) => uploadObservationBatch(ownerUserId, events, currentOwner),
      onEvent: event => useOrderObservationStore().record(event),
    });
    outbox.wake();
  }
  catch { /* 观察启动失败不阻断客户端启动 */ }
}

export function createObservationContext(parent: ObservationContext = {}, queue = false): ObservationContext | undefined {
  try {
    const ownerUserId = parent.ownerUserId || currentOwner();
    if (!ownerUserId)
      return undefined;
    return {
      ownerUserId,
      executionId: parent.executionId,
      parentAttemptId: parent.parentAttemptId,
      retryRound: parent.retryRound,
      sequence: 0,
      ...(queue ? { queueId: crypto.randomUUID() } : { attemptId: crypto.randomUUID(), queueId: parent.queueId }),
      anchorAttemptId: parent.anchorAttemptId,
      anchorOrderId: parent.anchorOrderId,
    };
  }
  catch { return undefined; }
}

export function observeOrder(context: ObservationContext | undefined, linkId: number | undefined, kind: ObservationKind, fields: Partial<OrderObservationEvent> = {}): void {
  try {
    if (!context?.ownerUserId || currentOwner() !== context.ownerUserId || !outbox)
      return;
    const sequence = (context.sequence || 0) + 1;
    context.sequence = sequence;
    const event = normalizeObservationEvent({
      ...fields,
      ...context,
      version: 1,
      eventId: crypto.randomUUID(),
      linkId: Number(linkId) || 0,
      kind,
      occurredAt: Date.now(),
      sequence,
    }, context.ownerUserId);
    if (event)
      outbox.enqueue(event);
  }
  catch { /* 观察失败、UUID/序列化异常不改变业务结果 */ }
}

export function observeOption(option: BetOption, account: PlatformAccount | undefined, kind: ObservationKind, fields: Partial<OrderObservationEvent> = {}): void {
  try {
    observeOrder(option.observation, option.diagnosticLinkId, kind, {
      provider: option.type,
      accountId: account?.accountId,
      target: option.target,
      phase: option.diagnosticAttempt,
      odds: option.newOdds || option.odds,
      amount: option.betMoney,
      planAmount: option.planBetMoney,
      exchange: option.stakeExchange,
      rate: option.stakeRate,
      currency: option.stakeCurrency,
      source: "client",
      ...fields,
    });
  }
  catch { /* 元数据读取错误同样隔离 */ }
}
