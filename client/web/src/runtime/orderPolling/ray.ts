/** [changmen 扩展] 后台 RAY 轮询可共享在途请求；下单回执确认独立查询，不绑定订单或保存。 */
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { getProvider } from "@/runtime/providers";

interface RayRead { session: ReturnType<typeof getAuthSessionVersion>; gateway: string | undefined; token: string | undefined; superseded?: boolean; task: Promise<VenueOrder[]> }
const reads = new Map<number, RayRead>();
let generation = 0;

export function readRayAccountOrders(account: PlatformAccount, options: { fresh?: boolean } = {}): Promise<VenueOrder[]> {
  if (account.provider !== "RAY")
    return Promise.reject(new Error("RAY 订单查询账号不一致"));
  const session = getAuthSessionVersion();
  const existing = reads.get(account.accountId);
  if (!options.fresh && existing && existing.session === session && existing.gateway === account.gateway && existing.token === account.token)
    return existing.task;
  // [changmen 扩展] 新确认开始后，旧监控回包不能再覆盖确认结果。
  if (options.fresh && existing) {
    existing.superseded = true;
    reads.delete(account.accountId);
  }
  const stamp = generation;
  const entry: RayRead = {
    session,
    gateway: account.gateway,
    token: account.token,
    task: Promise.resolve().then(async () => {
      const orders = await getProvider(account)?.getOrders?.(account);
      if (stamp !== generation || !isAuthSessionCurrent(session)
        || entry.gateway !== account.gateway || entry.token !== account.token) {
        throw new Error("RAY 订单查询会话已变更");
      }
      if (entry.superseded)
        throw new Error("RAY 旧监控查询已被新的回执确认替代");
      return orders ?? [];
    }).finally(() => {
      if (reads.get(account.accountId) === entry)
        reads.delete(account.accountId);
    }),
  };
  // 回执确认不加入共享池；其完成不能移除随后启动的新监控查询。
  if (!options.fresh)
    reads.set(account.accountId, entry);
  return entry.task;
}

export function resetRayOrderPolling(): void {
  generation++;
  reads.clear();
}
