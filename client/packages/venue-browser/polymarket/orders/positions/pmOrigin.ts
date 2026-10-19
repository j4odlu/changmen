import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "@changmen/client-core/contract";

/** changmen 站内下单 vs 官网/其它客户端同步 */
export type PolymarketOrderOrigin = "changmen" | "external";

const STORAGE_PREFIX = "pmChangmenOrderIds:";

function storageKey(playerId: number): string {
  return `${STORAGE_PREFIX}${playerId}`;
}

function loadOrderIdSet(playerId: number): Set<string> {
  if (typeof localStorage === "undefined")
    return new Set();
  try {
    const raw = localStorage.getItem(storageKey(playerId));
    if (!raw)
      return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr))
      return new Set();
    return new Set(arr.map(v => String(v).trim()).filter(Boolean));
  }
  catch {
    return new Set();
  }
}

function saveOrderIdSet(playerId: number, ids: Set<string>): void {
  if (typeof localStorage === "undefined")
    return;
  try {
    localStorage.setItem(storageKey(playerId), JSON.stringify([...ids]));
  }
  catch {
    // quota / private mode
  }
}

/** changmen 下注成功时登记 orderId（持久化到 localStorage） */
export function markPolymarketChangmenOrder(playerId: number, orderId: string): void {
  const id = String(orderId ?? "").trim();
  if (!playerId || !id)
    return;
  const set = loadOrderIdSet(playerId);
  if (set.has(id))
    return;
  set.add(id);
  saveOrderIdSet(playerId, set);
}

export function isPolymarketChangmenOrder(playerId: number, orderId: string): boolean {
  const id = String(orderId ?? "").trim();
  if (!playerId || !id)
    return false;
  return loadOrderIdSet(playerId).has(id);
}

export function resolvePolymarketOrderOrigin(
  playerId: number,
  orderId: string,
  stored?: PolymarketOrderOrigin,
): PolymarketOrderOrigin {
  if (stored === "changmen" || isPolymarketChangmenOrder(playerId, orderId))
    return "changmen";
  return "external";
}

export function applyPolymarketOrderOrigins(
  account: PlatformAccount,
  orders: VenueOrder[],
): VenueOrder[] {
  const playerId = account.accountId;
  return orders.map((order) => {
    const stored = order.pmOrigin as PolymarketOrderOrigin | undefined;
    return {
      ...order,
      pmOrigin: resolvePolymarketOrderOrigin(playerId, order.orderId, stored),
    };
  });
}
