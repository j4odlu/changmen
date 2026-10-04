/**
 * 体育页 `/sports` 专用会话：只共用投注账号（加载 + 余额刷新）。
 * 禁止电竞 mainBetLoop / 采集 / fo / Client_GetOrderList（双标签时由 `/` 页负责电竞 runtime）。
 * 电竞余额环已在跑时：不另起、不改 opts、卸载不停它。
 */
import { useAccountStore } from "@/stores/accountStore";
import { stopFootballOrderRuntime, useFootballOrderStore } from "@/stores/footballOrderStore";
import { useUserStore } from "@/stores/userStore";
import { applyVenueTransportRoutingOnLogin } from "@/runtime/venueTransportSession";

const FOOTBALL_ORDER_REFRESH_MS = 45_000;
let footballOrderTimer: ReturnType<typeof setInterval> | null = null;
let sportsOwnsBalanceLoop = false;
let sportsSessionGen = 0;

async function refreshFootballOrders(settle: boolean) {
  const footballOrders = useFootballOrderStore();
  if (footballOrders.loading)
    return;
  await footballOrders.load();
  if (settle)
    await footballOrders.syncVenueSettlement();
}

/** SportsWorkspace onMounted：账号壳，不启电竞环 */
export async function mountSportsSession(): Promise<void> {
  const gen = ++sportsSessionGen;
  const user = useUserStore();
  if (!user.userId)
    await user.fetchUserInfo();
  await applyVenueTransportRoutingOnLogin({ ensurePmMarketHub: false });
  const accountStore = useAccountStore();
  await accountStore.loadAccounts(false);
  void refreshFootballOrders(true);
  if (!footballOrderTimer) {
    footballOrderTimer = setInterval(() => {
      void refreshFootballOrders(true);
    }, FOOTBALL_ORDER_REFRESH_MS);
  }
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
      console.warn("[sportsSession] pmVault unlock skipped", err);
  }
  // 不调用 bootSessionRuntime / startAppSession（无采集、无 mainBetLoop）
  void (async () => {
    try {
      await accountStore.loadTagPlatforms();
      if (gen !== sportsSessionGen)
        return;
      if (accountStore.balanceRefreshRunning)
        return;
      sportsOwnsBalanceLoop = true;
      accountStore.startBalanceRefreshLoop();
      const balanceRefresh = await import("@/stores/account/balanceRefresh");
      await balanceRefresh.refreshAllFromVenues(accountStore, true, {
        includeEsportOrderList: false,
        includeVenueOrders: true,
      });
    }
    catch (err) {
      if (import.meta.env?.DEV)
        console.warn("[sportsSession] post-unlock refresh", err);
    }
  })();
}

/**
 * SportsWorkspace 卸载：只停本页足球轮询。
 * 仅当本页自己拉起了余额环才停；电竞 KeepAlive 环不动。
 * 不 lock vault / 不 reset 传输 / 不清账号。
 */
export function stopSportsSession(): void {
  sportsSessionGen += 1;
  stopFootballOrderRuntime();
  if (footballOrderTimer) {
    clearInterval(footballOrderTimer);
    footballOrderTimer = null;
  }
  if (!sportsOwnsBalanceLoop)
    return;
  sportsOwnsBalanceLoop = false;
  useAccountStore().stopBalanceRefreshLoop();
}
