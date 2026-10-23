import type { BetOption } from "@changmen/client-core/models/betOption";
import type { AccountRecord, CreateTagPlatformIdentity } from "@changmen/client-core/types/account";
import type { PlatformId } from "@/types/esport";
import { defineStore } from "pinia";
import { PlatformAccount } from "@/models/platformAccount";
import { getExchange } from "@/shared/currency";
import * as accountCrud from "@/stores/account/accountCrud";
import { getProviders, pickAccount } from "@/stores/account/accountPicker";
import * as balanceRefresh from "@/stores/account/balanceRefresh";
import { checkBetting, placeBet, pausePendingVenueConfirmations } from "@/stores/account/betGateway";

/** 对齐 A8 Pinia `Io` */
export const useAccountStore = defineStore("account", {
  state: () => ({
    accounts: [] as PlatformAccount[],
    tagPlatforms: [] as import("@/types/esport").TagPlatformRow[],
    loaded: false,
    loading: false,
    /** A8 Io.f 连续轮询开关（loadAccounts(true) 置位） */
    balanceRefreshRunning: false,
    /** 管理端预览他人工作区时注入的账号快照，禁止 saveAccounts 写回当前登录用户 */
    adminWorkspacePreview: false,
    providerPickIndex: new Map<PlatformId, number>(),
    editDialogOpen: false,
    editDialogAccount: undefined as PlatformAccount | undefined,
  }),

  getters: {
    sortedAccounts: s => [...s.accounts].sort(PlatformAccount.sortByProvider),

    /** [changmen 扩展] 左上角总余额统一折算为 CNY；A8 此处直接累加原币。 */
    totalBalance: s =>
      s.accounts.reduce((sum, a) => sum + (a.balance ?? 0) * getExchange(a.currency), 0),

    totalToday: s => s.accounts.reduce((sum, a) => sum + (a.today ?? 0), 0),

    totalOrders: s => s.accounts.reduce((sum, a) => sum + (a.orderCount ?? 0), 0),

    getPlatformName: s => (platformId?: number, fallback = "") => {
      if (!platformId)
        return fallback;
      const row = s.tagPlatforms.find(
        p => p.ID === platformId || p.Id === platformId,
      );
      return row?.Name || row?.Platform || fallback;
    },
  },

  actions: {
    findAccount(accountId?: number) {
      if (!accountId)
        return undefined;
      const id = Number(accountId);
      return this.accounts.find(a => Number(a.accountId) === id);
    },

    openCreateAccount() {
      accountCrud.openCreateAccount(this);
    },

    openEditAccount(account: PlatformAccount) {
      accountCrud.openEditAccount(this, account);
    },

    closeAccountDialog() {
      accountCrud.closeAccountDialog(this);
    },

    loadTagPlatforms() {
      return accountCrud.loadTagPlatforms(this);
    },

    loadAccounts(refreshBalances = false) {
      return accountCrud.loadAccounts(this, refreshBalances);
    },

    saveAccounts() {
      return accountCrud.persistAccounts(this);
    },

    saveSportAccount(accountId: number, sportOb: AccountRecord["sportOb"] | undefined, clear = false) {
      return accountCrud.persistSportAccount(this, accountId, sportOb, clear);
    },

    createTagPlatform(platformName: string, identity: CreateTagPlatformIdentity) {
      return accountCrud.createTagPlatformForAccount(platformName, identity);
    },

    createAccount(record: AccountRecord) {
      return accountCrud.createAccount(this, record);
    },

    createFromTagPlatform(
      form: Partial<AccountRecord> & {
        platformName: string;
        playerName: string;
        provider: AccountRecord["provider"];
      },
    ) {
      return accountCrud.createFromTagPlatform(this, form);
    },

    deleteAccount(accountId: number) {
      return accountCrud.deleteAccount(this, accountId);
    },

    refreshBalance(account: PlatformAccount) {
      return account.updateBalance();
    },

    updateVenueOrders(
      account: PlatformAccount,
      opts?: import("@/stores/account/venueOrders").SyncVenueOrdersOpts,
    ) {
      return account.updateOrders(opts);
    },

    refreshAllFromVenues() {
      return balanceRefresh.refreshAllFromVenues(this, false);
    },

    refreshAllBalances() {
      return this.refreshAllFromVenues();
    },

    startBalanceRefreshLoop() {
      balanceRefresh.startBalanceRefreshLoop(this);
    },

    stopBalanceRefreshLoop() {
      balanceRefresh.stopBalanceRefreshLoop(this);
    },

    /** logout / 切换用户：清空内存账号，避免上一用户列表被误保存 */
    resetSession() {
      this.stopBalanceRefreshLoop();
      pausePendingVenueConfirmations();
      this.adminWorkspacePreview = false;
      this.accounts = [];
      this.loaded = false;
      this.loading = false;
      this.editDialogOpen = false;
      this.editDialogAccount = undefined;
    },

    saveMoneyLogForAccount(
      accountId: number,
      money: number,
      type: "Recharge" | "Withdraw" | string,
      description = "",
    ) {
      return accountCrud.saveMoneyLogForAccount(this, accountId, money, type, description);
    },

    getProviders(minBetMoney?: number) {
      return getProviders(this, minBetMoney);
    },

    getAccount(
      provider: PlatformId,
      betMoney: number,
      excludeAccountIds: number[] = [],
      filter?: (acc: PlatformAccount) => boolean,
      options?: BetOption[],
    ) {
      return pickAccount(this, provider, betMoney, excludeAccountIds, filter, options);
    },

    checkBetting(
      account: PlatformAccount | undefined,
      option: BetOption,
      opts?: import("@/stores/account/betGateway").CheckBettingOpts,
    ) {
      return checkBetting(this, account, option, opts);
    },

    betting(
      account: PlatformAccount | undefined,
      option: BetOption,
      toastSeconds = 10,
      opts?: import("@/stores/account/betGateway").PlaceBetOpts,
    ) {
      return placeBet(this, account, option, toastSeconds, opts);
    },
  },
});
