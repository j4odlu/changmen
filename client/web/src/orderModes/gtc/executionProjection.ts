/** [changmen 扩展] GTC 财务订单独立投影；不以 Link 或当前模式认定订单来源。 */
import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { OrderRow } from "@/types/order";
import { reactive } from "vue";

export const gtcOrderProjection = reactive({ owner: "", date: "", rows: [] as OrderRow[] });
const identities = new Map<string, string>();
let identityOwner = "";
function key(player: unknown, provider: unknown, orderId: unknown): string {
  return JSON.stringify([Number(player), String(provider ?? ""), String(orderId ?? "").trim().toLowerCase()]);
}
function financialRow(row: OrderRow, source: string): OrderRow {
  const gross = Number(row.PmGtcBuyShares);
  // 原 PM 展示/人工卖出助手以 gross - attributed 计算余量。
  // GTC 库内 pmShares 是净仓；只在独立投影中适配，不能改 FOK 的算法。
  const needsGross = row.Type === "Polymarket" && row.PmSide !== "sell"
    && row.PmGtcBuyShares != null && Number.isFinite(gross) && gross >= 0;
  if (row.PmGtcExecutionId === source && (!needsGross || row.PmShares === gross))
    return row;
  return { ...row, PmGtcExecutionId: source, ...(needsGross ? { PmShares: gross } : {}) };
}
export function rememberGtcOrderIdentity(row: GtcExecution): void {
  if (identityOwner && identityOwner !== row.owner)
    identities.clear();
  identityOwner = row.owner;
  for (const id of [row.orderId, row.plan.orderHash].filter(Boolean))
    identities.set(key(row.plan.playerId, "Polymarket", id), row.id);
  if (row.other.orderId)
    identities.set(key(row.plan.otherPlayerId, row.plan.otherProvider, row.other.orderId), row.id);
}
export function resetGtcOrderProjection(): void {
  identities.clear();
  identityOwner = "";
  gtcOrderProjection.owner = "";
  gtcOrderProjection.date = "";
  gtcOrderProjection.rows = [];
}
export function tagKnownGtcVenueOrders(playerId: number, rows: VenueOrder[]): VenueOrder[] {
  let changed = false;
  const tagged = rows.map((row) => {
    const id = identities.get(key(playerId, row.provider, row.pmBuyOrderId ?? row.orderId));
    if (!id)
      return row;
    changed = true;
    return { ...row, pmGtcExecutionId: id };
  });
  return changed ? tagged : rows;
}
export function partitionGtcOrderRows(rows: OrderRow[], owner = identityOwner): { fok: OrderRow[]; gtc: OrderRow[] } {
  const sourceByOrder = new Map<string, string>();
  for (const row of rows) {
    const source = row.PmGtcExecutionId || (owner === identityOwner && identities.get(key(row.PlayerID, row.Type, row.OrderID)));
    if (source)
      sourceByOrder.set(key(row.PlayerID, row.Type, row.OrderID), source);
  }
  const gtc: OrderRow[] = [];
  const fok: OrderRow[] = [];
  for (const row of rows) {
    const source = sourceByOrder.get(key(row.PlayerID, row.Type, row.OrderID))
      || sourceByOrder.get(key(row.PlayerID, row.Type, row.PmBuyOrderId ?? row.PfBuyOrderId));
    if (source)
      gtc.push(financialRow(row, source));
    else
      fok.push(row);
  }
  return { fok: gtc.length ? fok : rows, gtc };
}
export function projectGtcOrderRows(rows: OrderRow[], owner: string, date: string): OrderRow[] {
  const split = partitionGtcOrderRows(rows, owner);
  gtcOrderProjection.owner = owner;
  gtcOrderProjection.date = date;
  gtcOrderProjection.rows = split.gtc;
  return split.fok;
}
export function applyGtcLocalSell(buyRow: OrderRow, rows: OrderRow[]): boolean {
  if (!buyRow.PmGtcExecutionId)
    return false;
  const byId = new Map(gtcOrderProjection.rows.map(row => [key(row.PlayerID, row.Type, row.OrderID), row]));
  for (const row of rows)
    byId.set(key(row.PlayerID, row.Type, row.OrderID), financialRow(row, buyRow.PmGtcExecutionId));
  gtcOrderProjection.rows = [...byId.values()];
  return true;
}
