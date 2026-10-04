import {
  installArbRuntimeSync,
  syncArbRuntime,
  teardownArbRuntimeSync,
} from "@/extensions/arbOpportunity/syncArbRuntime";
import { bootSessionRuntime, stopSessionRuntime } from "@/runtime/sessionBoot";
import { useAccountStore } from "@/stores/accountStore";
import { useMatchStore } from "@/stores/matchStore";
import { useMessageStore } from "@/stores/messageStore";
import { useOddsStore } from "@/stores/oddsStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { lockPmVault, resetPmVaultAccountUi } from "@/security/pmVault";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";

async function applyPmTransportRoutingOnLogin(): Promise<void> {
  try {
    const {
      applyPmAutoTransportOnLogin,
      ensurePolymarketMarketQuoteHub,
    } = await import("@changmen/venue-adapter/polymarket");
    const result = await applyPmAutoTransportOnLogin();
    if (result.marketWsMode === "official")
      ensurePolymarketMarketQuoteHub();
  }
  catch (err) {
    if (import.meta.env?.DEV)
      console.warn("[PM transport] auto route skipped", err);
  }
}

async function applyPfTransportRoutingOnLogin(): Promise<void> {
  try {
    const { applyPfAutoTransportOnLogin } = await import("@changmen/venue-adapter/predictfun");
    await applyPfAutoTransportOnLogin();
  }
  catch (err) {
    if (import.meta.env?.DEV)
      console.warn("[PF transport] auto route skipped", err);
  }
}

async function resetPmTransportRoutingOnLogout(): Promise<void> {
  try {
    const {
      resetPmTransportRoutingOnLogout,
      stopPolymarketMarketQuoteHub,
    } = await import("@changmen/venue-adapter/polymarket");
    stopPolymarketMarketQuoteHub();
    resetPmTransportRoutingOnLogout();
  }
  catch {
    /* ignore */
  }
}

async function resetPfTransportRoutingOnLogout(): Promise<void> {
  try {
    const { resetPfTransportRoutingOnLogout } = await import("@changmen/venue-adapter/predictfun");
    resetPfTransportRoutingOnLogout();
  }
  catch {
    /* ignore */
  }
}

/** HomeView 挂载时：主循环、消息队列、扩展旁路 sync（调用顺序与原先 HomeView 一致） */
export function startAppSession(): void {
  useMatchStore().startMainLoop();
  useMessageStore().start();
  installArbRuntimeSync();
  syncArbRuntime();
}

/** HomeView onMounted：先拉账号并解锁本机钱包，再启主循环与余额刷新 */
export async function mountAppSession(): Promise<void> {
  const sessionVersion = getAuthSessionVersion();
  const user = useUserStore();
  if (!user.userId) {
    await user.fetchUserInfo();
  }
  await applyPmTransportRoutingOnLogin();
  await applyPfTransportRoutingOnLogin();
  const accountStore = useAccountStore();
  // 先快速拉账号列表（不阻塞在余额刷新上），以便尽早弹解锁框
  await accountStore.loadAccounts(false);
  try {
    const {
      ensurePmVaultForAccounts,
      hasVault,
      mergeVaultKeysIntoAccounts,
      migrateTokenPrivateKeysToVault,
      normalizePmVaultUserId,
    } = await import("@/security/pmVault");
    const uid = normalizePmVaultUserId(user.userId);
    if (uid && await hasVault(uid)) {
      const unlocked = await ensurePmVaultForAccounts(uid, accountStore.accounts);
      if (unlocked) {
        mergeVaultKeysIntoAccounts(accountStore.accounts, uid);
        const migrated = await migrateTokenPrivateKeysToVault(accountStore.accounts, uid);
        if (migrated > 0)
          void accountStore.saveAccounts();
      }
    }
  }
  catch (err) {
    if (import.meta.env?.DEV)
      console.warn("[pmVault] unlock skipped", err);
  }
  await bootSessionRuntime();
  if (!isAuthSessionCurrent(sessionVersion))
    return;
  startAppSession();
  // 解锁完成后再刷余额 / 订单（与原 loadAccounts(true) 后半段对齐）
  void (async () => {
    try {
      await accountStore.loadTagPlatforms();
      accountStore.startBalanceRefreshLoop();
      const balanceRefresh = await import("@/stores/account/balanceRefresh");
      await balanceRefresh.refreshAllFromVenues(accountStore, true);
      const { useOrderStore } = await import("@/stores/orderStore");
      await useOrderStore().fetchOrders();
    }
    catch (err) {
      if (import.meta.env?.DEV)
        console.warn("[mountAppSession] post-unlock refresh", err);
    }
  })();
}

/** HomeView 卸载 / logout：对称 teardown（不含 user.logout） */
export function stopAppSession(): void {
  void resetPmTransportRoutingOnLogout();
  void resetPfTransportRoutingOnLogout();
  lockPmVault({ preservePmSession: true });
  resetPmVaultAccountUi();
  stopSessionRuntime();
  teardownArbRuntimeSync();
  useMessageStore().stop();
  useMatchStore().stopMainLoop();
  useAccountStore().stopBalanceRefreshLoop();
  clearSessionCaches();
}

/** 清除运行时缓存，避免 SPA 切换用户后残留上一 session 的数据 */
function clearSessionCaches(): void {
  const matchStore = useMatchStore();
  matchStore.matchs = [];
  matchStore.defaultOdds.clear();
  matchStore.defaultOddsFetchedAt = 0;
  matchStore.lastFetchAt = 0;
  matchStore.lastLoseOrderPruneAt = Date.now();

  useOddsStore().$reset();
  useOrderStore().$reset();
  useAccountStore().resetSession();
}
