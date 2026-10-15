import type { PmSubmission } from "@changmen/shared/pm_submission";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { OrderRow } from "@/types/order";
import { getAuthSessionVersion, isAuthSessionCurrent, post, unwrap } from "@/api/client";
import { tagKnownGtcVenueOrders } from "./executionProjection";
import { reconcileGtcSellFinancials } from "./sellFinancials";
import { listGtc } from "./api";
import { pendingGtcResults } from "./localStore";
import { confirmedGtcResult } from "./confirmedResult";

/** [changmen 扩展] 监控恢复按原单身份取数，不受侧栏日期限制，不建立第二份财务列表。 */
export async function loadGtcMonitorOrders(ids: string[], isCurrent: () => boolean = () => true): Promise<OrderRow[]> {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
    throw new Error("GTC 监控恢复执行 ID 无效");
  if (!ids.length) return [];
  const session = getAuthSessionVersion();
  const checkCurrent = () => {
    if (!isAuthSessionCurrent(session) || !isCurrent())
      throw new Error("GTC 监控恢复登录状态已变更");
  };
  const read = async <T>(action: string, body: Record<string, unknown>) => {
    checkCurrent();
    const response = await post<T>(action, body, "", { errorTip: false });
    checkCurrent();
    return response;
  };
  const rows: OrderRow[] = [];
  const records = await listGtc();
  checkCurrent();
  if (ids.some(id => !records.some(row => row.id === id))) throw new Error("GTC 本地原单身份尚未恢复");
  const confirmed = records.filter(row => ids.includes(row.id) && row.fills && Number(confirmedGtcResult(row)?.financial.pmShares) > 0);
  // [changmen 扩展] 读取前捕获待同步状态，避免同步确认与 RDS 读取交错时误报缺失。
  const pending = new Set(confirmed.length ? (await pendingGtcResults(confirmed[0]!.owner)).map(entry => entry.result.executionId) : []);
  checkCurrent();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const batch = ids.slice(offset, offset + 1000);
    const anchors = records.filter(row => batch.includes(row.id)).flatMap(row => [
      { executionId: row.id, playerId: row.plan.playerId, provider: "Polymarket", orderId: row.orderId || row.plan.orderHash },
      ...(row.other.orderId ? [{ executionId: row.id, playerId: row.plan.otherPlayerId, provider: row.plan.otherProvider, orderId: row.other.orderId }] : []),
    ]);
    for (let start = 0; start < anchors.length; start += 1000) {
      const selected = anchors.slice(start, start + 1000);
      const orders = unwrap(await read<OrderRow[]>("Pm_GtcReadResults", { anchors: selected }));
      if (!Array.isArray(orders) || orders.some(order => !selected.some(anchor => order.PmGtcExecutionId === anchor.executionId
        && order.PlayerID === anchor.playerId && order.Type === anchor.provider && String(order.OrderID).toLowerCase() === anchor.orderId.toLowerCase())))
        throw new Error("GTC 监控恢复订单响应无效");
      rows.push(...orders);
    }
  }
  checkCurrent();
  if (confirmed.some(row => !pending.has(row.id) && !rows.some(order => order.PmGtcExecutionId === row.id
    && order.PlayerID === row.plan.playerId && order.Type === "Polymarket")))
    throw new Error("GTC 监控恢复已确认原单财务记录缺失，请核对原单身份");
  return rows;
}

export async function getPmSubmission(playerId: number, orderId: string): Promise<PmSubmission | null> {
  const response = await post<PmSubmission>("Pm_GetSubmission", { playerId, orderId }, "", { errorTip: false });
  return response.success === 1 ? response.info ?? null : null;
}

export async function saveOrders(account: PlatformAccount, orders: VenueOrder[]): Promise<void> {
  if (account.provider === "PredictFun")
    return;
  const session = getAuthSessionVersion();
  const checkCurrent = () => { if (!isAuthSessionCurrent(session)) throw new Error("GTC 结果保存登录状态已变更"); };
  checkCurrent();
  const tagged = await reconcileGtcSellFinancials(account, tagKnownGtcVenueOrders(account.accountId, orders));
  checkCurrent();
  const groups = new Map<string, VenueOrder[]>();
  const records = await listGtc();
  checkCurrent();
  for (const order of tagged) {
    const type = String(order.provider ?? account.provider);
    if (type === "PredictFun")
      continue;
    const list = groups.get(type) ?? [];
    list.push(order);
    groups.set(type, list);
  }
  for (const [type, list] of groups) {
    const origins = list.map(order => {
      const id = (order as VenueOrder & { pmGtcExecutionId?: string }).pmGtcExecutionId;
      const execution = records.find(row => row.id === id);
      if (!execution || ![execution.plan.playerId, execution.plan.otherPlayerId].includes(account.accountId))
        throw new Error("GTC 已确认原单身份缺失");
      return { executionId: execution.id, playerId: account.accountId, provider: type,
        orderId: order.pmBuyOrderId ?? order.pfBuyOrderId ?? order.orderId };
    });
    checkCurrent();
    unwrap(await post("Pm_GtcSaveOrders", { type, playerId: account.accountId, orders: JSON.stringify(list), origins }));
    checkCurrent();
  }
}

export async function refreshGtcOrders(date?: string, isCurrent: () => boolean = () => true): Promise<void> {
  const session = getAuthSessionVersion();
  const { useOrderStore } = await import("@/stores/orderStore");
  if (!isAuthSessionCurrent(session) || !isCurrent())
    return;
  const store = useOrderStore();
  await store.fetchOrders(date ?? store.orderDate);
}
