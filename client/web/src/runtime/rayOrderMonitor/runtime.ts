/** [changmen 扩展] RAY 用户端原单监控：恢复、查单、本地更新及拒单事件，不写订单数据库。 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { OrderRow } from "@/types/order";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { readRayAccountOrders, resetRayOrderPolling } from "@/runtime/orderPolling/ray";
import { rayMonitoring, resetRayMonitoring, setRayMonitoring } from "./state";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { loadRayMonitorOrders } from "./api";
import { rayClientStatus, updateRayOrdersLocally } from "./localOrders";
import { bindRayOrderContexts, observeRayOrderContexts, resumeRayContextMakeup } from "./contexts";
import { useRayOrderContextStore } from "./contextStore";
import { hasRaySubmissionPreviews, observeRaySubmissionPreviews, readRaySubmissionPreviewOrders, retireRaySubmissionPreviews, resetRaySubmissionPreviews, setRaySubmissionPreviewWake } from "./submissionPreview";

export const RAY_ORDER_POLL_MS = 5000;
export const RAY_ORDER_RECOVERY_MS = 60_000;
const tasks = new Map<string, OrderRow>();
const finished = new Set<string>();
const polling = new Map<number, Promise<void>>();
const recovering = new Map<number, Promise<void>>();
const recoveredAt = new Map<number, number>();
const polledAt = new Map<number, number>();
let owner = "";
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const key = (row: OrderRow) => `${row.PlayerID}:${row.OrderID}`;
const terminal = (status: unknown) => ["win", "lose", "lost", "return", "reject"].includes(String(status).toLowerCase());
const storageKey = () => `changmen:ray-order-monitor:v1:${owner}`;

function persist(): void {
  try { sessionStorage.setItem(storageKey(), JSON.stringify([...tasks.values()])); }
  catch { /* 数据库仍保留原单，下次恢复继续监控。 */ }
}
function register(row: OrderRow): void {
  if (!row || row.Type !== "RAY" || !row.PlayerID || !String(row.OrderID ?? "").trim() || row.DisplayOnly)
    return;
  const id = key(row);
  if (terminal(row.Status)) {
    tasks.delete(id); finished.add(id);
    const state = rayMonitoring.orders.get(id);
    if (state?.phase !== "closed" || String(state.status).toLowerCase() !== String(row.Status).toLowerCase())
      setRayMonitoring(owner, row.PlayerID, String(row.OrderID), { phase: "closed", status: String(row.Status) });
  }
  else if (!finished.has(id)) {
    const previous = tasks.get(id);
    tasks.set(id, { ...previous, ...row, Status: previous?.Status ?? row.Status });
    if (!rayMonitoring.orders.has(id))
      setRayMonitoring(owner, row.PlayerID, String(row.OrderID), { phase: "watching", status: String(row.Status) });
  }
}
/** 同一会话跨日期保留任务；不把陈旧侧栏快照重新登记为未结算。 */
export function recoverRaySettlement(): void {
  const current = String(useUserStore().userId || "");
  if (!current || useUserStore().isLoggedIn === false || useAccountStore().adminWorkspacePreview)
    return;
  if (owner !== current) {
    clearRuntime(); owner = current;
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey())
        || sessionStorage.getItem(`changmen:ray-settlement:v1:${owner}`) || "[]");
      if (Array.isArray(stored)) {
        for (const row of stored)
          register(row);
      }
    }
    catch { /* 损坏的会话缓存不阻止数据库恢复。 */ }
  }
  const contexts = useRayOrderContextStore(); contexts.restore(current);
  retireRaySubmissionPreviews([...useOrderStore().orders.values()].flat());
  for (const row of [...useOrderStore().orders.values()].flat())
    register(row);
  for (const task of contexts.activeTasks) {
    if (task.boundOrderId && (task.monitorBound || task.bindingSaved) && !tasks.has(`${task.accountId}:${task.boundOrderId}`))
      register({ Type: "RAY", PlayerID: task.accountId, OrderID: task.boundOrderId, Link: task.linkId, Status: "None" });
  }
  persist();
}
function capture(account: PlatformAccount): () => boolean {
  const stamp = generation; const session = getAuthSessionVersion(); const currentOwner = owner;
  const binding = JSON.stringify([account.gateway, account.token, account.currency]);
  return () => stamp === generation && owner === currentOwner
    && String(useUserStore().userId || "") === currentOwner && isAuthSessionCurrent(session)
    && useUserStore().isLoggedIn !== false
    && !useAccountStore().adminWorkspacePreview && useAccountStore().findAccount(account.accountId) === account
    && binding === JSON.stringify([account.gateway, account.token, account.currency]);
}
function recoverAccount(account: PlatformAccount): void {
  const id = account.accountId;
  if (recovering.has(id) || (recoveredAt.has(id) && Date.now() - recoveredAt.get(id)! < RAY_ORDER_RECOVERY_MS))
    return;
  const current = capture(account);
  const ids = [...tasks.values()].filter(row => row.PlayerID === id).map(row => String(row.OrderID));
  const task = loadRayMonitorOrders(id, ids).then((rows) => {
    if (!current())
      return;
    for (const row of rows) {
      if (row.PlayerID === id) {
        register(row);
        for (const context of useRayOrderContextStore().activeTasks) {
          if (context.accountId === id && context.boundOrderId === String(row.OrderID) && context.linkId === row.Link)
            useRayOrderContextStore().patch(context.key, { bindingSaved: true });
        }
      }
    }
    observeRayOrderContexts(id, rows.filter(row => row.PlayerID === id && terminal(row.Status)).map(row => ({
      orderId: String(row.OrderID), status: String(row.Status).toLowerCase().replace("lost", "lose") as VenueOrder["status"],
    })), current);
    recoveredAt.set(id, Date.now()); persist();
    pollAccount(account);
  }).catch((error) => {
    if (current())
      reportError(id, error);
  }).finally(() => {
    if (recovering.get(id) === task)
      recovering.delete(id);
  });
  recovering.set(id, task);
}
function reportError(player: number, error: unknown): void {
  for (const row of tasks.values()) {
    if (row.PlayerID === player)
      setRayMonitoring(owner, player, String(row.OrderID), { phase: "watching", status: String(row.Status), error: error instanceof Error ? error.message : String(error) });
  }
}
function pollAccount(account: PlatformAccount): void {
  const player = account.accountId;
  // 原下注确认窗口仍使用自己的查单；后台查询不能覆盖在途确认结果。
  const previewing = hasRaySubmissionPreviews(account);
  if (polling.has(player) || (account.active && !previewing) || (polledAt.has(player) && Date.now() - polledAt.get(player)! < RAY_ORDER_POLL_MS))
    return;
  const originals = new Set([...tasks.values()].filter(row => row.PlayerID === player).map(key));
  if (!previewing && !originals.size && !useRayOrderContextStore().activeTasks.some(task => task.accountId === player))
    return;
  polledAt.set(player, Date.now());
  const current = capture(account);
  const task = (async () => {
    const startedAt = Date.now();
    const orders = account.active ? await readRaySubmissionPreviewOrders(account) : await readRayAccountOrders(account);
    if (current())
      observeRaySubmissionPreviews(account, orders, startedAt);
    if (!current() || account.active)
      return;
    recoverRaySettlement();
    bindRayOrderContexts(account, orders, () => current() && !account.active);
    for (const context of useRayOrderContextStore().activeTasks) {
      if (context.accountId !== player || !context.boundOrderId || !context.monitorBound)
        continue;
      const id = `${player}:${context.boundOrderId}`;
      const known = tasks.get(id);
      // 保留原 Link 冲突保护：监控不能把其他套利组的原单交给本组补单。
      if (known?.Link && known.Link !== context.linkId && known.Link !== known.CreateAt && known.Link !== Number(known.CreateAt) - 1) {
        useRayOrderContextStore().patch(context.key, { monitorBound: false, bindingSaved: false, lastError: "场馆原单已属于其他 Link，未自动改绑" });
        continue;
      }
      register({ ...known, Type: "RAY", PlayerID: player, OrderID: context.boundOrderId, Link: context.linkId, Status: "None" });
      originals.add(id);
    }
    // GTC 等客户端消费者可能先更新侧栏为终态；拒单事件仍由本轮唯一场馆事实触发。
    const contextOrders = orders.filter(order => order.provider === "RAY"
      && useRayOrderContextStore().activeTasks.some(context => context.accountId === player
        && context.monitorBound && context.boundOrderId === order.orderId));
    const matched = orders.filter(order => order.provider === "RAY" && originals.has(`${player}:${order.orderId}`) && tasks.has(`${player}:${order.orderId}`));
    const seen = new Set(matched.map(order => `${player}:${order.orderId}`));
    for (const id of originals) {
      const row = tasks.get(id);
      if (row && !seen.has(id))
        setRayMonitoring(owner, player, String(row.OrderID), { phase: "watching", status: String(row.Status), error: "场馆本次未返回该原单，继续查询" });
    }
    updateRayOrdersLocally(player, matched);
    for (const order of matched) {
      const id = `${player}:${order.orderId}`;
      const row = tasks.get(id);
      if (!row)
        continue;
      row.Status = rayClientStatus(order.status);
      setRayMonitoring(owner, player, order.orderId, { phase: terminal(order.status) ? "closed" : "watching", status: order.status });
      if (terminal(order.status)) { tasks.delete(id); finished.add(id); }
    }
    persist();
    observeRayOrderContexts(player, contextOrders, current);
  })().catch((error) => {
    if (current() && !account.active)
      reportError(player, error);
  }).finally(() => {
    if (polling.get(player) === task)
      polling.delete(player);
  });
  polling.set(player, task);
}
export function pollRaySettlement(): void {
  if (!useUserStore().userId || useUserStore().isLoggedIn === false || useAccountStore().adminWorkspacePreview)
    return;
  recoverRaySettlement();
  const stamp = generation; const currentOwner = owner; const session = getAuthSessionVersion();
  resumeRayContextMakeup(() => stamp === generation && owner === currentOwner
    && String(useUserStore().userId || "") === currentOwner && useUserStore().isLoggedIn !== false
    && isAuthSessionCurrent(session) && !useAccountStore().adminWorkspacePreview);
  for (const account of useAccountStore().accounts) {
    if (account.provider !== "RAY")
      continue;
    recoverAccount(account);
    pollAccount(account);
  }
}
function clearRuntime(): void {
  generation++; tasks.clear(); finished.clear(); polling.clear(); recovering.clear(); recoveredAt.clear(); polledAt.clear();
}
export function stopRaySettlement(): void { clearRuntime(); owner = ""; }
export function startRayOrderMonitoring(): void {
  if (timer)
    return;
  recoverRaySettlement();
  setRaySubmissionPreviewWake((account) => {
    const current = useAccountStore().findAccount(account.accountId);
    if (timer && current === account) { polledAt.delete(account.accountId); pollAccount(current); }
  });
  const stamp = generation;
  const tick = () => {
    if (stamp !== generation)
      return;
    pollRaySettlement();
    timer = setTimeout(tick, RAY_ORDER_POLL_MS);
  };
  tick();
}
export function stopRayOrderMonitoring(): void {
  clearTimeout(timer); timer = undefined;
  resetRaySubmissionPreviews();
  stopRaySettlement(); resetRayOrderPolling(); resetRayMonitoring();
}
