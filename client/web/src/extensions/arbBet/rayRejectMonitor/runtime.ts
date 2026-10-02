import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { RayRejectMonitorTask, RegisterRayRejectMonitorInput } from "./types";
import { saveUserLog } from "@/api/chat";
import { saveOrders } from "@/api/order";
import { getProvider } from "@/runtime/providers";
import { observeOrder } from "@/services/orderObservation";
import { useAccountStore } from "@/stores/accountStore";
import { bindArbOrderId, refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";
import { useUserStore } from "@/stores/userStore";
import {
  RAY_REJECT_MONITOR_DEFAULT_MINUTES,
  RAY_REJECT_MONITOR_MAX_MINUTES,
  RAY_REJECT_MONITOR_MIN_MINUTES,
} from "@/types/extensionPrefs";
import { matchRayVenueOrder } from "./match";
import { useRayRejectMonitorStore } from "./store";

export const RAY_MONITOR_FAST_WINDOW_MS = 15 * 1000;
export const RAY_MONITOR_MEDIUM_WINDOW_MS = 60 * 1000;

let tickInFlight = false;

function monitorKey(input: RegisterRayRejectMonitorInput, userId: string): string {
  return `${userId}:${input.linkId}:${input.side}:${input.accountId}`;
}

function configuredMonitorMinutes(): number {
  const raw = Number(useUserStore().extensionPrefs?.rayLateRejectAutoMakeup?.monitorMinutes);
  if (!Number.isFinite(raw))
    return RAY_REJECT_MONITOR_DEFAULT_MINUTES;
  return Math.round(Math.min(
    RAY_REJECT_MONITOR_MAX_MINUTES,
    Math.max(RAY_REJECT_MONITOR_MIN_MINUTES, raw),
  ));
}

function pollGapMs(task: RayRejectMonitorTask, now: number): number {
  const age = Math.max(0, now - task.submittedAt);
  if (age <= RAY_MONITOR_FAST_WINDOW_MS)
    return 1_000;
  if (age <= RAY_MONITOR_MEDIUM_WINDOW_MS)
    return 3_000;
  return 10_000;
}

function isTerminalVenueStatus(status: VenueOrder["status"]): boolean {
  return status === "win" || status === "lose" || status === "return";
}

function writeMonitorLog(
  task: RayRejectMonitorTask,
  event: "registered" | "bound" | "rejected" | "closed" | "expired",
  order?: VenueOrder,
  extra: Record<string, unknown> = {},
): void {
  try {
    const titles = {
      registered: "RAY旁路监控 => 已登记",
      bound: "RAY旁路监控 => 已绑定场馆订单",
      rejected: "RAY旁路监控 => 检测到延迟拒单",
      closed: "RAY旁路监控 => 场馆订单已结算",
      expired: "RAY旁路监控 => 观察超时",
    } as const;
    observeOrder(task.observation, task.linkId, event === "rejected" || event === "closed" ? "settlement_observed" : "decision", {
      provider: "RAY",
      accountId: task.accountId,
      orderId: order?.orderId || task.boundOrderId,
      target: task.target,
      outcome: event === "rejected" ? "unfilled" : event === "closed" ? "filled" : event,
      source: "ray_monitor",
      observedStatus: order?.status,
      reasonCode: event,
    });
    void saveUserLog(titles[event], {
      diagnosticVersion: 3,
      monitoringMode: "shadow",
      monitorEvent: event,
      linkId: task.linkId,
      provider: "RAY",
      accountId: task.accountId,
      orderId: order?.orderId ?? task.boundOrderId ?? null,
      betId: task.betId,
      side: task.side,
      target: task.target,
      match: task.match,
      bet: task.bet,
      item: task.item,
      odds: task.odds,
      betMoney: task.betMoney,
      placedAt: task.submittedAt,
      observedAt: Date.now(),
      rejectDelayMs: task.rejectDelayMs ?? null,
      observedStatus: order?.status ?? task.lastObservedStatus ?? "missing",
      shadowOnly: true,
      ...extra,
    }).catch(() => {});
  }
  catch {
    /* 影子日志不能影响下注或监控 */
  }
}

function applyCandidate(
  task: RayRejectMonitorTask,
  orders: readonly VenueOrder[],
  now: number,
): { task: RayRejectMonitorTask; order?: VenueOrder; newlyBound: boolean } {
  if (task.boundOrderId) {
    const order = orders.find(row => String(row.orderId) === task.boundOrderId);
    return { task, order, newlyBound: false };
  }

  const matched = matchRayVenueOrder(task, orders);
  if (matched.kind !== "matched") {
    return {
      task: {
        ...task,
        status: matched.kind === "ambiguous" ? "ambiguous" : "binding",
        candidateCount: matched.candidates.length,
        updatedAt: now,
      },
      newlyBound: false,
    };
  }

  const venueSubmittedAt = Number(matched.candidate.order.createAt) > 0
    ? Number(matched.candidate.order.createAt)
    : task.submittedAt;
  return {
    task: {
      ...task,
      status: "watching",
      submittedAt: venueSubmittedAt,
      expiresAt: venueSubmittedAt + task.monitorMinutes * 60_000,
      boundOrderId: String(matched.candidate.order.orderId),
      boundAt: now,
      candidateCount: matched.candidates.length,
      updatedAt: now,
    },
    order: matched.candidate.order,
    newlyBound: true,
  };
}

function markRejected(
  store: ReturnType<typeof useRayRejectMonitorStore>,
  task: RayRejectMonitorTask,
  order: VenueOrder,
  now: number,
): void {
  const autoMakeupEnabled = useUserStore().extensionPrefs?.rayLateRejectAutoMakeup?.enabled === true;
  const rejected: RayRejectMonitorTask = {
    ...task,
    status: "rejected",
    boundOrderId: String(order.orderId),
    lastObservedStatus: "reject",
    rejectedAt: now,
    rejectDelayMs: Math.max(0, now - task.submittedAt),
    autoMakeupStatus: autoMakeupEnabled ? undefined : "disabled",
    autoMakeupReason: autoMakeupEnabled ? undefined : "自动补单未开启",
    lastError: undefined,
    updatedAt: now,
  };
  store.upsert(rejected);
  // 先固化拒单事实；自动处置作为独立桥接异步执行，不改变现有编排结果。
  writeMonitorLog(rejected, "rejected", order);
  if (!autoMakeupEnabled)
    return;
  // [changmen 扩展] 动态加载独立处置桥；任何失败都只落监控状态，不回抛到编排。
  void import("./autoMakeup")
    .then(({ handleRayLateRejectAutoMakeup }) => handleRayLateRejectAutoMakeup(rejected))
    .catch((error) => {
      store.patch(rejected.key, {
        autoMakeupStatus: "failed",
        autoMakeupReason: error instanceof Error ? error.message : String(error),
        autoMakeupAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
}

async function persistObservedRayOrder(
  account: ReturnType<typeof useAccountStore>["accounts"][number],
  task: RayRejectMonitorTask,
  order: VenueOrder,
  orders: readonly VenueOrder[],
  bind: boolean,
): Promise<void> {
  try {
    const orderId = String(order.orderId);
    const stamped = orders.map(row => String(row.orderId) === orderId
      ? { ...row, link: task.linkId }
      : row);
    await saveOrders(account, stamped);
    if (bind)
      await bindArbOrderId(task.linkId, "RAY", task.accountId, orderId);
    refreshOrderListAfterBind();
  }
  catch {
    // 旁路持久化失败不得中断拒单监控；下一轮状态变化仍可重试。
  }
}

/**
 * settle 完成后登记 RAY 影子任务。全函数隔离异常且不返回编排结论。
 * 已被原编排发现的即时拒单不重复登记。
 */
export function registerRayRejectMonitor(input: RegisterRayRejectMonitorInput): void {
  try {
    if (input.initialRejected || !input.linkId || !input.accountId)
      return;
    const userId = String(useUserStore().userId || "").trim();
    if (!userId)
      return;
    const store = useRayRejectMonitorStore();
    store.restore(userId);
    const key = monitorKey(input, userId);
    if (store.tasks.has(key))
      return;

    const now = Date.now();
    const monitorMinutes = configuredMonitorMinutes();
    let task: RayRejectMonitorTask = {
      observation: input.observation,
      key,
      userId,
      linkId: input.linkId,
      matchId: input.matchId,
      betId: input.betId,
      side: input.side,
      accountId: input.accountId,
      submittedAt: input.submittedAt || now,
      monitorMinutes,
      expiresAt: (input.submittedAt || now) + monitorMinutes * 60_000,
      match: input.match,
      bet: input.bet,
      item: input.item,
      target: input.target,
      odds: input.odds,
      betMoney: input.betMoney,
      anchorConfirmed: input.anchorConfirmed,
      anchorProvider: input.anchorProvider,
      anchorAccountId: input.anchorAccountId,
      anchorBetMoney: input.anchorBetMoney,
      anchorOdds: input.anchorOdds,
      status: "binding",
      candidateCount: 0,
      pollCount: 0,
      nextPollAt: now + 1_000,
      updatedAt: now,
    };

    const applied = applyCandidate(task, input.initialOrders, now);
    task = applied.task;
    if (applied.order) {
      task.lastObservedStatus = applied.order.status;
      if (isTerminalVenueStatus(applied.order.status))
        task.status = "closed";
      else if (applied.order.status === "reject")
        task.status = "rejected";
    }
    writeMonitorLog(task, "registered", applied.order, {
      candidateCount: task.candidateCount,
      bindingStatus: task.status,
      monitorMinutes: task.monitorMinutes,
    });
    if (applied.newlyBound && applied.order)
      writeMonitorLog(task, "bound", applied.order);
    if (task.status === "closed" && applied.order) {
      writeMonitorLog(task, "closed", applied.order);
      return;
    }
    if (task.status === "rejected" && applied.order) {
      markRejected(store, task, applied.order, now);
      return;
    }
    if (task.expiresAt <= now) {
      writeMonitorLog(task, "expired", applied.order);
      return;
    }
    store.upsert(task);
  }
  catch {
    /* 旁路模块不得改变 finalize 结果 */
  }
}

async function pollAccountTasks(
  tasks: RayRejectMonitorTask[],
  now: number,
): Promise<void> {
  const store = useRayRejectMonitorStore();
  const account = useAccountStore().findAccount(tasks[0]?.accountId);
  if (!account || String(account.provider).toUpperCase() !== "RAY") {
    for (const task of tasks) {
      store.patch(task.key, {
        lastError: "RAY账号不可用",
        nextPollAt: now + 10_000,
        updatedAt: now,
      });
    }
    return;
  }

  if (account.active) {
    for (const task of tasks)
      store.patch(task.key, { nextPollAt: now + 1_000, updatedAt: now });
    return;
  }

  const provider = getProvider(account);
  if (!provider?.getOrders) {
    for (const task of tasks) {
      store.patch(task.key, {
        lastError: "RAY订单查询不可用",
        nextPollAt: now + 10_000,
        updatedAt: now,
      });
    }
    return;
  }

  let orders: VenueOrder[];
  try {
    orders = await provider.getOrders(account);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const task of tasks) {
      store.patch(task.key, {
        lastError: message,
        nextPollAt: now + 10_000,
        updatedAt: now,
      });
    }
    return;
  }

  const observedAt = Date.now();
  for (const original of tasks) {
    const applied = applyCandidate(original, orders, observedAt);
    const task: RayRejectMonitorTask = {
      ...applied.task,
      pollCount: original.pollCount + 1,
      lastPollAt: observedAt,
      nextPollAt: observedAt + pollGapMs(original, observedAt),
      lastError: undefined,
      updatedAt: observedAt,
    };
    const order = applied.order;
    if (applied.newlyBound && order)
      writeMonitorLog(task, "bound", order);
    if (!order) {
      task.lastObservedStatus = "missing";
      if (task.expiresAt <= observedAt) {
        store.remove(task.key);
        writeMonitorLog(task, "expired");
        continue;
      }
      store.upsert(task);
      continue;
    }

    task.lastObservedStatus = order.status;
    if (applied.newlyBound || order.status !== original.lastObservedStatus) {
      await persistObservedRayOrder(
        account,
        task,
        order,
        orders,
        applied.newlyBound,
      );
    }
    if (order.status === "reject") {
      markRejected(store, task, order, observedAt);
      continue;
    }
    if (isTerminalVenueStatus(order.status)) {
      store.remove(task.key);
      writeMonitorLog({ ...task, status: "closed" }, "closed", order);
      continue;
    }
    if (task.expiresAt <= observedAt) {
      store.remove(task.key);
      writeMonitorLog(task, "expired", order);
      continue;
    }
    task.status = "watching";
    store.upsert(task);
  }
}

/** 主循环旁路 tick：同步返回，网络查询在模块内部串行执行。 */
export function runRayRejectMonitorTick(): void {
  try {
    const userId = String(useUserStore().userId || "").trim();
    if (!userId)
      return;
    const store = useRayRejectMonitorStore();
    store.restore(userId);
    const now = Date.now();

    for (const task of store.activeTasks) {
      if (now < task.expiresAt)
        continue;
      const expired = { ...task, status: "expired" as const, updatedAt: now };
      store.remove(task.key);
      writeMonitorLog(expired, "expired");
    }

    if (tickInFlight)
      return;
    const due = store.activeTasks
      .filter(task => task.nextPollAt <= now && task.expiresAt > now)
      .sort((a, b) => a.nextPollAt - b.nextPollAt);
    const first = due[0];
    if (!first)
      return;
    const sameAccount = due.filter(task => task.accountId === first.accountId);
    tickInFlight = true;
    void pollAccountTasks(sameAccount, now)
      .catch(() => {})
      .finally(() => {
        tickInFlight = false;
      });
  }
  catch {
    tickInFlight = false;
  }
}
