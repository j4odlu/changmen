import type { AdminUserRow } from "@/types/admin";
import type { OrderRow } from "@/types/order";
import type { UserConfig } from "@/types/userConfig";
import { getAdminOrdersAll } from "@/api/admin";
import { adminAccountToPlatformAccount } from "@/components/admin/adminAccountDisplay";
import { PlatformAccount } from "@/models/platformAccount";
import { gtcOrderProjection, projectGtcOrderRows } from "@/orderModes/gtc/executionProjection";
import { adminOrderToOrderRow } from "@/shared/adminOrderDisplay";
import { todayKey } from "@/shared/dateKey";
import {
  dropOrphanPolymarketSellGroups,
  filterOrdersBelongingToDate,
  groupOrdersByEffectiveLink,
} from "@/shared/orderLink";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import { useUserStore } from "@/stores/userStore";
import { mergeUserConfig } from "@/types/userConfig";

interface WorkspaceSnapshot {
  accounts: PlatformAccount[];
  accountLoaded: boolean;
  editDialogOpen: boolean;
  editDialogAccount?: PlatformAccount;
  config: UserConfig;
  configLoaded: boolean;
  orders: Map<number, OrderRow[]>;
  orderDate: string;
  filterAccountId: number;
}

function cloneAccounts(accounts: PlatformAccount[]): PlatformAccount[] {
  return accounts.map(
    acc =>
      new PlatformAccount({
        accountId: acc.accountId,
        platformId: acc.platformId,
        platformName: acc.platformName,
        playerName: acc.playerName,
        provider: acc.provider,
        proxyId: acc.proxyId,
        gateway: acc.gateway,
        token: acc.token,
        referer: acc.referer,
        userAgent: acc.userAgent,
        cookie: acc.cookie,
        balance: acc.balance,
        credit: acc.credit,
        currency: acc.currency,
        updateTime: acc.updateTime,
        active: acc.active,
        today: acc.today,
        orderCount: acc.orderCount,
        unsettle: acc.unsettle,
        maxBalance: acc.maxBalance,
        minOdds: acc.minOdds,
        maxOdds: acc.maxOdds,
        minDefault: acc.minDefault,
        maxDefault: acc.maxDefault,
        totalProfit: acc.totalProfit,
        maxProfit: acc.maxProfit,
        maxOrder: acc.maxOrder,
        todayOrder: acc.todayOrder,
        pause: acc.pause,
        markupOnly: acc.markupOnly,
        noMarkup: acc.noMarkup,
        workTimes: acc.workTimes,
        winBalance: acc.winBalance,
        maxWinBalance: acc.maxWinBalance,
        profit: acc.profit,
        maxBetCount: acc.maxBetCount,
        multiply: acc.multiply,
        game: acc.game,
        rateConfig: acc.rateConfig,
        description: acc.description,
        realName: acc.realName,
        mobile: acc.mobile,
        venueMemberId: acc.venueMemberId,
        venueAccountName: acc.venueAccountName,
      }),
  );
}

/** 管理端详情：拉取指定用户订单并写入 orderStore（供 OrderView 展示） */
export async function loadEmbeddedUserOrders(userId: string, date: string) {
  const orderStore = useOrderStore();
  const accountStore = useAccountStore();
  const page = await getAdminOrdersAll({ userId, date });
  const raw = (page.list ?? []).map(row => adminOrderToOrderRow(row, accountStore.accounts));
  const dateKey = date || page.date || todayKey();
  // 后端已 enrich 并对 Link 开弓日过滤；此处再滤一次 + Link 对齐，与侧栏一致
  projectGtcOrderRows(raw, userId, dateKey);
  const byId = new Map(gtcOrderProjection.rows.map(row => [JSON.stringify([row.PlayerID, row.Type, row.OrderID]), row]));
  const list = filterOrdersBelongingToDate(raw.map(row => byId.get(JSON.stringify([row.PlayerID, row.Type, row.OrderID])) ?? row), dateKey);
  orderStore.orders = dropOrphanPolymarketSellGroups(groupOrdersByEffectiveLink(list));
  orderStore.orderDate = dateKey;
  orderStore.updateTodayProfit(list);
}

/** 将 AdminUserRow 注入 Pinia（同步），返回恢复函数；订单由 loadEmbeddedUserOrders 异步拉取 */
let activeRestore: (() => void) | null = null;

export function unmountAdminUserWorkspace() {
  activeRestore?.();
  activeRestore = null;
}

export function mountAdminUserWorkspace(user: AdminUserRow): void {
  unmountAdminUserWorkspace();

  const accountStore = useAccountStore();
  const userStore = useUserStore();
  const orderStore = useOrderStore();

  accountStore.stopBalanceRefreshLoop();
  const gtcSnapshot = { ...gtcOrderProjection, rows: [...gtcOrderProjection.rows] };
  gtcOrderProjection.rows = [];

  const snap: WorkspaceSnapshot = {
    accounts: cloneAccounts(accountStore.accounts),
    accountLoaded: accountStore.loaded,
    editDialogOpen: accountStore.editDialogOpen,
    editDialogAccount: accountStore.editDialogAccount,
    config: toRawConfig(userStore.config),
    configLoaded: userStore.configLoaded,
    orders: new Map(orderStore.orders),
    orderDate: orderStore.orderDate,
    filterAccountId: orderStore.filterAccountId,
  };

  accountStore.$patch({
    accounts: (user.accounts ?? []).map(adminAccountToPlatformAccount),
    loaded: true,
    editDialogOpen: false,
    editDialogAccount: undefined,
    adminWorkspacePreview: true,
  });

  userStore.$patch({
    config: mergeUserConfig(user.setting as Partial<UserConfig>),
    configLoaded: true,
  });

  orderStore.orders = new Map();
  orderStore.filterAccountId = 0;

  activeRestore = () => {
    Object.assign(gtcOrderProjection, gtcSnapshot);
    accountStore.$patch({
      accounts: snap.accounts,
      loaded: snap.accountLoaded,
      editDialogOpen: snap.editDialogOpen,
      editDialogAccount: snap.editDialogAccount,
      adminWorkspacePreview: false,
    });
    userStore.$patch({
      config: snap.config,
      configLoaded: snap.configLoaded,
    });
    orderStore.orders = snap.orders;
    orderStore.orderDate = snap.orderDate;
    orderStore.filterAccountId = snap.filterAccountId;
  };
}

function toRawConfig(config: UserConfig): UserConfig {
  try {
    return structuredClone(config);
  }
  catch {
    return mergeUserConfig(config);
  }
}
