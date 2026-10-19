import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { useCollectStore } from "../shared/webBridge";
import { useAccountStore } from "../shared/webBridge";

const POLL_MS = 60_000;

/**
 * 皇冠 HG 无标准电竞实时赔率流（对齐 backend hg_feed.js）。
 * A8 SQ 为跟单下注循环，非 saveMatch 采集。
 * 启用 HG 采集开关时：轮询已配置 gateway+token 的 HG 账号余额（与后端 hg_feed 一致）。
 */
export function startHgCollector(): () => void {
  let stopped = false;

  const poll = async () => {
    const collect = useCollectStore();
    const accountStore = useAccountStore();
    while (!stopped) {
      if (collect.isEnabled(PLATFORMS.HG)) {
        const hgAccounts = accountStore.accounts.filter(
          (a) => a.provider === PLATFORMS.HG && a.gateway && a.token && !a.active,
        );
        if (!hgAccounts.length) {
          console.debug(
            "[HG] 无电竞赔率流；请配置 HG 账号 gateway+token，或使用跟单循环",
          );
        } else {
          for (const acc of hgAccounts) {
            try {
              await accountStore.refreshBalance(acc);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn("[HG] balance refresh failed", acc.accountId, msg);
            }
          }
        }
      }
      await wait(POLL_MS);
    }
  };

  void poll();

  return () => {
    stopped = true;
  };
}
