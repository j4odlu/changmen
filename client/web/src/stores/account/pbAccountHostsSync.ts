import type { PlatformAccount } from "@/models/platformAccount";
import { a8PluginSetStore, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import { pbHostsFromAccounts, setPbAccountPageHosts } from "@changmen/venue-browser/adapter/pb";

/** 与扩展 chrome.storage 键一致 */
export const PB_ACCOUNT_HOSTS_KEY = "pbAccountHosts";

/** [changmen 扩展] 把 PB 账号 referer/gateway 主机推给扩展；不改 A8 saveAccounts 载荷 */
export async function syncPbAccountHosts(accounts: PlatformAccount[]): Promise<void> {
  const hosts = pbHostsFromAccounts(accounts);
  setPbAccountPageHosts(hosts);
  if (!hasA8PluginRuntime())
    return;
  try {
    await a8PluginSetStore(PB_ACCOUNT_HOSTS_KEY, hosts);
  }
  catch {
    /* 扩展通信失败不阻断账号主流程 */
  }
}
