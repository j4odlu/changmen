import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";

const writes = new Map<string, Promise<void>>();
const keyFor = (version: string, accountId: number, orderId: string) => JSON.stringify([version, accountId, orderId.trim().toLowerCase()]);

/** [changmen 扩展] 注册先于写入：确认、自动收尾和普通拉单共用原单写入屏障。 */
export function runPendingPmOrderWrite(accountId: number, orderId: string, write: () => Promise<void>): Promise<void> {
  const key = keyFor(getAuthSessionVersion(), accountId, orderId);
  const existing = writes.get(key);
  if (existing) return existing;
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const completion = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  writes.set(key, completion);
  void (async () => {
    try { await write(); resolve(); }
    catch (error) { reject(error); }
    finally { if (writes.get(key) === completion) writes.delete(key); }
  })();
  return completion;
}

/** 只阻塞同一会话/账号/订单的后续写入；原 Pending 写入不能等待自身。 */
export function pendingPmOrderWriteBarrier(accountId: number, orders: VenueOrder[]): (() => Promise<void>) | undefined {
  if (!writes.size) return undefined;
  const version = getAuthSessionVersion();
  const pending = orders.filter(order => String(order.provider).trim() === "Polymarket" && String(order.status).toLowerCase() !== "pending")
    .map(order => writes.get(keyFor(version, accountId, String(order.orderId)))).filter(value => value !== undefined);
  if (!pending.length) return undefined;
  return async () => {
    await Promise.all(pending);
    if (!isAuthSessionCurrent(version)) throw new Error("会话已切换，停止同步原单");
  };
}
