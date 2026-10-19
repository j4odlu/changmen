import type { PlatformProvider } from "@changmen/venue-browser/adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { getProvider as venueProvider } from "@/runtime/venueAdapters";
import { beginRayOrderObservation } from "./orderMonitoring/rayOrders";
import { beginRaySubmissionPreview } from "./rayOrderMonitor/submissionPreview";

export { supportedBetProviders } from "@/runtime/venueAdapters";
const observed = new WeakMap<PlatformProvider, PlatformProvider>();

/** [changmen 扩展] 原查询每次照常执行，只旁听返回值；不缓存、合并、重试或等待消费者。 */
export function getProvider(account: PlatformAccount): PlatformProvider | undefined {
  const provider = venueProvider(account);
  if (account.provider !== "RAY" || !provider?.getOrders)
    return provider;
  let wrapper = observed.get(provider);
  if (!wrapper) {
    wrapper = { ...provider, betting(account, option) {
      let accept: ReturnType<typeof beginRaySubmissionPreview>;
      try { accept = beginRaySubmissionPreview(account, option); }
      catch { /* 提前展示登记失败不阻断原下注。 */ }
      return provider.betting.call(provider, account, option).then((result) => {
        try { accept?.(result); }
        catch { /* 提前展示不改变原回执。 */ }
        return result;
      });
    }, getOrders(account) {
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
