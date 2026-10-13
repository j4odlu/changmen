import type { PlatformProvider } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { getProvider as venueProvider } from "@/runtime/venueAdapters";
import { beginRayOrderObservation } from "./orderMonitoring/rayOrders";

export { supportedBetProviders } from "@/runtime/venueAdapters";
const observed = new WeakMap<PlatformProvider, PlatformProvider>();

/** [changmen 扩展] 原查询每次照常执行，只旁听返回值；不缓存、合并、重试或等待消费者。 */
export function getProvider(account: PlatformAccount): PlatformProvider | undefined {
  const provider = venueProvider(account);
  if (account.provider !== "RAY" || !provider?.getOrders)
    return provider;
  let wrapper = observed.get(provider);
  if (!wrapper) {
    wrapper = { ...provider, getOrders(account) {
      const publish = beginRayOrderObservation(account);
      return provider.getOrders!.call(provider, account).then((orders) => {
        try { publish(orders); }
        catch { /* 被动展示不能影响原查询结果和拒单检测。 */ }
        return orders;
      });
    } };
    observed.set(provider, wrapper);
  }
  return wrapper;
}
