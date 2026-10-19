/** [changmen 扩展] 被动接收原有 RAY 查单结果；不发请求、不设置定时器、不干预拒单或补单。 */
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import { shallowReactive } from "vue";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";

export interface RayOrderSnapshot {
  sequence: number;
  startedAt: number;
  orders: readonly VenueOrder[];
}
interface Snapshot extends RayOrderSnapshot {
  session: ReturnType<typeof getAuthSessionVersion>;
  binding: string;
}
const snapshots = new Map<number, Snapshot>();
export const rayOrderResults = shallowReactive({ revision: 0 });
let generation = 0;
let sequence = 0;
const binding = (account: PlatformAccount) => JSON.stringify([account.provider, account.accountId, account.gateway, account.token, account.currency]);

export function beginRayOrderObservation(account: PlatformAccount): (orders: VenueOrder[]) => void {
  const session = getAuthSessionVersion();
  const original = binding(account);
  const accountId = account.accountId;
  const stamp = generation;
  const request = ++sequence;
  const startedAt = Date.now();
  return (orders) => {
    if (account.provider !== "RAY" || !Array.isArray(orders) || stamp !== generation
      || !isAuthSessionCurrent(session) || binding(account) !== original) {
      return;
    }
    const previous = snapshots.get(accountId);
    if (previous && previous.session === session && previous.sequence > request)
      return;
    snapshots.set(accountId, { session, binding: original, sequence: request, startedAt, orders: Object.freeze(orders.map(order => Object.freeze({ ...order }))) });
    rayOrderResults.revision++;
  };
}

export function observedRayOrders(account: PlatformAccount): RayOrderSnapshot | undefined {
  const snapshot = snapshots.get(account.accountId);
  return snapshot && snapshot.session === getAuthSessionVersion() && isAuthSessionCurrent(snapshot.session)
    && snapshot.binding === binding(account)
    ? snapshot
    : undefined;
}

export function resetRayOrderResults(): void {
  generation++; snapshots.clear(); rayOrderResults.revision++;
}
